"use server";

import { revalidatePath } from "next/cache";
import { logAuditEvent } from "@/lib/audit";
import { getCurrentProfile, normalizeRole } from "@/lib/permissions";
import { createClient, hasSupabaseEnv } from "@/lib/supabase-server";
import { documentBucketForEntity } from "@/lib/transaction-document-config";
import {
  documentEntityPath,
  getTransactionDocumentContext,
  isTransactionDocumentEntity
} from "@/lib/transaction-documents";
import type { TransactionDocument } from "@/lib/types";

const allowedDocumentMimeTypes = new Set(["application/pdf", "image/jpeg", "image/png", "image/webp"]);

function field(formData: FormData, key: string) {
  const value = formData.get(key);
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function integerField(formData: FormData, key: string) {
  const value = Number(field(formData, key));
  return Number.isInteger(value) && value >= 0 ? value : null;
}

function safeFileName(value: string) {
  const trimmed = value.trim().replace(/[^a-zA-Z0-9._-]+/g, "-").replace(/-+/g, "-");
  return trimmed.replace(/^-|-$/g, "") || "document";
}

function normalizeDocumentProfile(document: {
  profiles?: { full_name?: string | null } | { full_name?: string | null }[] | null;
}) {
  return Array.isArray(document.profiles) ? (document.profiles[0] ?? null) : (document.profiles ?? null);
}

async function requireDocumentActor() {
  const profile = await getCurrentProfile();
  if (!profile?.is_active || normalizeRole(profile.role) === "staff") {
    throw new Error("You do not have permission to manage transaction documents.");
  }
  return profile;
}

function documentAuditData(document: {
  compressed_size_bytes?: number | null;
  document_type?: string | null;
  file_name: string;
  file_size_bytes?: number | null;
  mime_type?: string | null;
}) {
  return {
    compressed_size_bytes: document.compressed_size_bytes ?? null,
    document_type: document.document_type ?? null,
    file_name: document.file_name,
    file_size_bytes: document.file_size_bytes ?? null,
    mime_type: document.mime_type ?? null
  };
}

function revalidateDocumentPaths(entityName: Parameters<typeof documentEntityPath>[0]) {
  revalidatePath(documentEntityPath(entityName));
  revalidatePath("/documents");
}

export async function uploadTransactionDocument(formData: FormData) {
  if (!hasSupabaseEnv()) return;

  const profile = await requireDocumentActor();
  const entityName = field(formData, "entity_name");
  const entityId = field(formData, "entity_id");
  const file = formData.get("file");
  if (!isTransactionDocumentEntity(entityName) || !entityId || !(file instanceof File) || file.size <= 0) {
    throw new Error("Choose a transaction and a document file.");
  }
  if (!allowedDocumentMimeTypes.has(file.type)) {
    throw new Error("Upload a PDF, JPG, PNG, or WebP document.");
  }

  const context = await getTransactionDocumentContext(entityName, entityId);
  if (!context) throw new Error("Transaction document target was not found or is not accessible.");

  const supabase = await createClient();
  const bucketName = documentBucketForEntity(context.entityName);
  const filePath = `${profile.id}/${entityName}/${entityId}/${crypto.randomUUID()}-${safeFileName(file.name)}`;
  const { error: storageError } = await supabase.storage.from(bucketName).upload(filePath, file, {
    cacheControl: "3600",
    contentType: file.type,
    upsert: false
  });
  if (storageError) throw storageError;

  const fileSizeBytes = integerField(formData, "original_size_bytes") ?? file.size;
  const compressedSizeBytes = integerField(formData, "compressed_size_bytes") ?? file.size;
  const { data: document, error } = await supabase.from("transaction_documents").insert({
    bank_account_id: context.bankAccountId,
    branch_id: context.branchId,
    compressed_size_bytes: compressedSizeBytes,
    document_type: field(formData, "document_type"),
    entity_id: context.entityId,
    entity_name: context.entityName,
    file_name: safeFileName(file.name),
    file_path: filePath,
    file_size_bytes: fileSizeBytes,
    mime_type: file.type,
    notes: field(formData, "notes"),
    uploaded_by: profile.id
  }).select("id, entity_name, entity_id, branch_id, bank_account_id, document_type, file_name, file_path, file_size_bytes, compressed_size_bytes, mime_type, notes, uploaded_by, created_at, deleted_at, deleted_by, delete_reason, profiles:profiles!transaction_documents_uploaded_by_fkey(full_name)").single();

  if (error || !document) {
    await supabase.storage.from(bucketName).remove([filePath]);
    throw error ?? new Error("Uploaded document record could not be loaded.");
  }

  const normalizedDocument = {
    ...document,
    profiles: normalizeDocumentProfile(document)
  } as TransactionDocument;

  await logAuditEvent({
    action: "document_upload",
    afterData: documentAuditData(document),
    bankAccountId: document.bank_account_id,
    branchId: document.branch_id,
    description: `Uploaded document ${document.file_name}.`,
    entityId: document.entity_id,
    entityName: document.entity_name
  });
  revalidateDocumentPaths(context.entityName);
  return normalizedDocument;
}

export async function deleteTransactionDocument(formData: FormData) {
  if (!hasSupabaseEnv()) return;

  const profile = await requireDocumentActor();
  const documentId = field(formData, "document_id");
  const deleteReason = field(formData, "delete_reason");
  if (!documentId || !deleteReason) throw new Error("Document and delete reason are required.");

  const supabase = await createClient();
  const { data: document, error: documentError } = await supabase
    .from("transaction_documents")
    .select("id, entity_name, entity_id, branch_id, bank_account_id, document_type, file_name, file_size_bytes, compressed_size_bytes, mime_type")
    .eq("id", documentId)
    .is("deleted_at", null)
    .maybeSingle();

  if (documentError || !document || !isTransactionDocumentEntity(document.entity_name)) {
    throw new Error("Document was not found or is not accessible.");
  }

  const { data: deletedDocument, error } = await supabase
    .from("transaction_documents")
    .update({
      delete_reason: deleteReason,
      deleted_at: new Date().toISOString(),
      deleted_by: profile.id
    })
    .eq("id", document.id)
    .is("deleted_at", null)
    .select("id, entity_name, entity_id, branch_id, bank_account_id, document_type, file_name, file_size_bytes, compressed_size_bytes, mime_type")
    .single();

  if (error || !deletedDocument) throw error ?? new Error("Deleted document record could not be loaded.");

  await logAuditEvent({
    action: "document_delete",
    bankAccountId: deletedDocument.bank_account_id,
    beforeData: documentAuditData(document),
    branchId: deletedDocument.branch_id,
    description: `Removed document ${deletedDocument.file_name}: ${deleteReason}`,
    entityId: deletedDocument.entity_id,
    entityName: deletedDocument.entity_name
  });
  revalidateDocumentPaths(deletedDocument.entity_name);
}
