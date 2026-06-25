"use server";

import { revalidatePath } from "next/cache";
import { logAuditEvent } from "@/lib/audit";
import { canEditBranch, getCurrentProfile, normalizeRole } from "@/lib/permissions";
import { createAdminClient } from "@/lib/supabase-admin";
import { createClient, hasSupabaseEnv } from "@/lib/supabase-server";
import { documentBucketForEntity } from "@/lib/transaction-document-config";
import {
  documentEntityPath,
  getTransactionDocumentContext,
  isTransactionDocumentEntity
} from "@/lib/transaction-documents";
import type { TransactionDocument, TransactionDocumentEntityName, TransactionDocumentUploadResult } from "@/lib/types";

const maxDocumentSizeBytes = 10 * 1024 * 1024;
const allowedDocumentMimeTypes = new Set(["application/pdf", "image/jpeg", "image/png", "image/webp"]);
const allowedDocumentExtensions = new Set(["pdf", "png", "jpg", "jpeg", "webp"]);
const allowedDocumentTypes = new Set([
  "receipt",
  "invoice",
  "payment_proof",
  "bank_slip",
  "claim_document",
  "supporting_document",
  "other"
]);

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

function shouldUseAdminDocumentFlow(entityName: TransactionDocumentEntityName) {
  return [
    "expenses",
    "cash_bank_ins",
    "petty_cash_transactions",
    "panel_claims",
    "supplier_purchases",
    "supplier_purchase_entries",
    "supplier_payment_entries"
  ].includes(entityName);
}

function uploadFailure(message: string): TransactionDocumentUploadResult {
  return { ok: false, message };
}

function uploadSuccess(document: TransactionDocument): TransactionDocumentUploadResult {
  return { ok: true, message: "Document uploaded successfully.", document };
}

function normalizeDocumentType(value: string | null) {
  if (!value) return "supporting_document";
  const normalized = value.trim().toLowerCase().replaceAll(" ", "_");
  return allowedDocumentTypes.has(normalized) ? normalized : null;
}

function fileExtension(name: string) {
  const match = name.toLowerCase().match(/\.([a-z0-9]+)$/);
  return match?.[1] ?? null;
}

function inferredMimeType(file: File) {
  const normalizedType = file.type.trim().toLowerCase();
  if (allowedDocumentMimeTypes.has(normalizedType)) {
    return normalizedType;
  }

  const extension = fileExtension(file.name);
  if (!extension || !allowedDocumentExtensions.has(extension)) {
    return null;
  }
  if (extension === "pdf") return "application/pdf";
  if (extension === "png") return "image/png";
  if (extension === "webp") return "image/webp";
  return "image/jpeg";
}

function friendlyUploadMessage(error: unknown) {
  const message = error instanceof Error ? error.message : "";
  if (message.includes("SUPABASE_SERVICE_ROLE_KEY")) {
    return "Server upload configuration is missing. Please check SUPABASE_SERVICE_ROLE_KEY.";
  }
  if (message.includes("Bucket not found")) {
    return "Upload storage is not configured for this document type.";
  }
  if (message.includes("row-level security")) {
    return "Upload failed. Please try again.";
  }
  return message || "Upload failed. Please try again.";
}

export async function uploadTransactionDocument(formData: FormData): Promise<TransactionDocumentUploadResult> {
  if (!hasSupabaseEnv()) {
    return uploadFailure("Server upload configuration is missing.");
  }

  let uploadedPath: string | null = null;
  let uploadedBucket: string | null = null;

  try {
    const profile = await requireDocumentActor();
    const entityName = field(formData, "entity_name");
    const entityId = field(formData, "entity_id");
    const file = formData.get("file");
    const rawDocumentType = field(formData, "document_type");
    const documentType = normalizeDocumentType(rawDocumentType);

    if (!isTransactionDocumentEntity(entityName) || !entityId) {
      return uploadFailure("Choose a valid transaction before uploading a document.");
    }
    if (!(file instanceof File) || file.size <= 0) {
      return uploadFailure("No file selected.");
    }
    if (file.size > maxDocumentSizeBytes) {
      return uploadFailure("File is too large. Maximum allowed size is 10MB.");
    }
    if (!documentType) {
      return uploadFailure("This document type is not allowed for this transaction.");
    }
    const mimeType = inferredMimeType(file);
    if (!mimeType) {
      return uploadFailure("Only PDF, PNG, JPG, JPEG, and WEBP files are allowed.");
    }

    let context = await getTransactionDocumentContext(entityName, entityId);
    if (shouldUseAdminDocumentFlow(entityName)) {
      const adminSupabase = createAdminClient();
      const loadContext = async () => {
        if (entityName === "supplier_payment_entries") {
          return adminSupabase
            .from("supplier_payment_entries")
            .select("id, branch_id, bank_account_id")
            .eq("id", entityId)
            .maybeSingle();
        }
        if (entityName === "cash_bank_ins") {
          return adminSupabase.from("cash_bank_ins").select("id, branch_id, bank_account_id").eq("id", entityId).maybeSingle();
        }
        if (entityName === "petty_cash_transactions") {
          return adminSupabase
            .from("petty_cash_transactions")
            .select("id, branch_id, bank_account_id")
            .eq("id", entityId)
            .maybeSingle();
        }
        if (
          entityName === "supplier_purchase_entries" ||
          entityName === "supplier_purchases" ||
          entityName === "expenses" ||
          entityName === "panel_claims"
        ) {
          return adminSupabase.from(entityName).select("id, branch_id").eq("id", entityId).maybeSingle();
        }
        return null;
      };

      const contextRow = await loadContext();
      const entry = contextRow?.data ?? null;
      const entryError = contextRow?.error ?? null;
      if (entryError || !entry) {
        console.error("uploadTransactionDocument entry lookup failed", {
          action: "uploadTransactionDocument",
          entityId,
          entityName,
          error: entryError?.message ?? "no row returned"
        });
        return uploadFailure("Transaction document target was not found or is not accessible.");
      }
      context = {
        bankAccountId: ("bank_account_id" in entry ? entry.bank_account_id : null) as string | null,
        branchId: (entry.branch_id ?? null) as string | null,
        entityId: entry.id as string,
        entityName
      };
    }

    if (!context) {
      return uploadFailure("Transaction document target was not found or is not accessible.");
    }
    if (context.entityName === "supplier_payment_entries" && !["owner", "admin", "finance"].includes(normalizeRole(profile.role))) {
      return uploadFailure("You do not have permission to upload documents for this record.");
    }
    if (!canEditBranch(profile, context.branchId)) {
      return uploadFailure("You do not have permission to upload documents for this record.");
    }

    const useAdminFlow = shouldUseAdminDocumentFlow(context.entityName);
    const supabase = useAdminFlow ? createAdminClient() : await createClient();
    const bucketName = documentBucketForEntity(context.entityName);
    const filePath = useAdminFlow
      ? `${entityName}/${context.entityId}/${Date.now()}-${safeFileName(file.name)}`
      : `${profile.id}/${entityName}/${entityId}/${crypto.randomUUID()}-${safeFileName(file.name)}`;

    console.info("uploadTransactionDocument starting", {
      action: "uploadTransactionDocument",
      userId: profile.id,
      role: normalizeRole(profile.role),
      entityName: context.entityName,
      entityId: context.entityId,
      documentType,
      bucket: bucketName,
      fileCount: 1,
      fileName: file.name,
      fileSizeBytes: file.size,
      mimeType,
      storagePath: filePath
    });

    const { error: storageError } = await supabase.storage.from(bucketName).upload(filePath, file, {
      cacheControl: "3600",
      contentType: mimeType,
      upsert: false
    });
    if (storageError) {
      console.error("uploadTransactionDocument storage upload failed", {
        action: "uploadTransactionDocument",
        userId: profile.id,
        role: normalizeRole(profile.role),
        entityId: context.entityId,
        entityName: context.entityName,
        documentType,
        bucket: bucketName,
        mimeType,
        storagePath: filePath,
        error: storageError.message,
        statusCode: storageError.statusCode
      });
      return uploadFailure(friendlyUploadMessage(storageError));
    }

    uploadedBucket = bucketName;
    uploadedPath = filePath;

    const fileSizeBytes = integerField(formData, "original_size_bytes") ?? file.size;
    const compressedSizeBytes = integerField(formData, "compressed_size_bytes") ?? file.size;
    const { data: document, error } = await supabase
      .from("transaction_documents")
      .insert({
        bank_account_id: context.bankAccountId,
        branch_id: context.branchId,
        compressed_size_bytes: compressedSizeBytes,
        document_type: documentType,
        entity_id: context.entityId,
        entity_name: context.entityName,
        file_name: safeFileName(file.name),
        file_path: filePath,
        file_size_bytes: fileSizeBytes,
        mime_type: mimeType,
        notes: field(formData, "notes"),
        uploaded_by: profile.id
      })
      .select(
        "id, entity_name, entity_id, branch_id, bank_account_id, document_type, file_name, file_path, file_size_bytes, compressed_size_bytes, mime_type, notes, uploaded_by, created_at, deleted_at, deleted_by, delete_reason, profiles:profiles!transaction_documents_uploaded_by_fkey(full_name)"
      )
      .single();

    if (error || !document) {
      await supabase.storage.from(bucketName).remove([filePath]);
      console.error("uploadTransactionDocument metadata insert failed", {
        action: "uploadTransactionDocument",
        userId: profile.id,
        role: normalizeRole(profile.role),
        entityId: context.entityId,
        entityName: context.entityName,
        documentType,
        bucket: bucketName,
        mimeType,
        storagePath: filePath,
        error: error?.message ?? "no row returned"
      });
      return uploadFailure("Document metadata could not be saved.");
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

    console.info("uploadTransactionDocument completed", {
      action: "uploadTransactionDocument",
      userId: profile.id,
      role: normalizeRole(profile.role),
      entityName: context.entityName,
      entityId: context.entityId,
      documentType,
      bucket: bucketName,
      mimeType,
      storagePath: filePath
    });

    return uploadSuccess(normalizedDocument);
  } catch (error) {
    if (uploadedBucket && uploadedPath) {
      try {
        const adminSupabase = createAdminClient();
        await adminSupabase.storage.from(uploadedBucket).remove([uploadedPath]);
      } catch (cleanupError) {
        console.error("uploadTransactionDocument cleanup failed", {
          action: "uploadTransactionDocument",
          bucket: uploadedBucket,
          storagePath: uploadedPath,
          error: cleanupError instanceof Error ? cleanupError.message : String(cleanupError)
        });
      }
    }

    console.error("uploadTransactionDocument unexpected failure", {
      action: "uploadTransactionDocument",
      entityName: field(formData, "entity_name"),
      entityId: field(formData, "entity_id"),
      documentType: field(formData, "document_type"),
      error: error instanceof Error ? error.message : String(error)
    });
    return uploadFailure(friendlyUploadMessage(error));
  }
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
