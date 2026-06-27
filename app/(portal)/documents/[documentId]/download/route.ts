import { createAdminClient } from "@/lib/supabase-admin";
import { documentBucketForEntity } from "@/lib/transaction-document-config";
import { getCurrentBankAccountPermissions, getCurrentProfile, normalizeRole } from "@/lib/permissions";
import { getTransactionDocumentContext, type TransactionDocumentContext } from "@/lib/transaction-documents";
import type { TransactionDocument } from "@/lib/types";

type DocumentDownloadRouteProps = {
  params: Promise<{ documentId: string }>;
};

function normalizeProfileRelation<T>(value: T | T[] | null | undefined) {
  return Array.isArray(value) ? (value[0] ?? null) : (value ?? null);
}

function candidateStoragePaths(filePath: string, bucketName: string) {
  const trimmed = filePath.trim();
  const normalized = trimmed.replace(/^\/+/, "");
  const candidates = new Set<string>([trimmed, normalized]);
  if (normalized.startsWith(`${bucketName}/`)) {
    candidates.add(normalized.slice(bucketName.length + 1));
  }

  try {
    const parsed = new URL(trimmed);
    const marker = `/${bucketName}/`;
    const index = parsed.pathname.indexOf(marker);
    if (index >= 0) {
      candidates.add(parsed.pathname.slice(index + marker.length).replace(/^\/+/, ""));
    }
  } catch {
    // Not a URL, keep local candidates only.
  }

  return Array.from(candidates).filter(Boolean);
}

function canAccessDocumentRoute(profile: Awaited<ReturnType<typeof getCurrentProfile>>, context: TransactionDocumentContext | null, document: TransactionDocument) {
  if (!profile?.is_active) {
    return { allowed: false, reason: "inactive_profile" as const };
  }

  const role = normalizeRole(profile.role);
  if (role === "staff") {
    return { allowed: false, reason: "staff_blocked" as const };
  }

  if (document.entity_name === "supplier_payment_entries" && !["owner", "admin", "finance"].includes(role)) {
    return { allowed: false, reason: "supplier_payment_entries_finance_only" as const };
  }

  const branchId = context?.branchId ?? document.branch_id ?? null;
  if (role === "owner" || role === "admin" || role === "finance") {
    return { allowed: true, reason: "management_access" as const };
  }

  if (role === "branch_pic" && branchId && profile.branch_id === branchId) {
    return { allowed: true, reason: "branch_pic_branch_match" as const };
  }

  return { allowed: false, reason: "branch_mismatch" as const };
}

export async function GET(request: Request, { params }: DocumentDownloadRouteProps) {
  const { documentId } = await params;
  const profile = await getCurrentProfile();
  if (!profile) {
    return new Response("You do not have permission to access this document.", { status: 403 });
  }

  const download = new URL(request.url).searchParams.has("download");
  const adminSupabase = createAdminClient();
  const { data: documentRow, error: documentError } = await adminSupabase
    .from("transaction_documents")
    .select("*, profiles:profiles!transaction_documents_uploaded_by_fkey(full_name)")
    .eq("id", documentId)
    .is("deleted_at", null)
    .maybeSingle();

  if (documentError) {
    console.error("documentDownload metadata lookup failed", {
      action: "documentDownload",
      documentId,
      userId: profile.id,
      userRole: normalizeRole(profile.role),
      userBranchId: profile.branch_id ?? null,
      error: documentError.message,
      code: documentError.code,
      details: documentError.details,
      hint: documentError.hint
    });
    return new Response("Document link could not be created.", { status: 403 });
  }

  if (!documentRow) {
    return new Response("Document not found.", { status: 404 });
  }

  const document = {
    ...documentRow,
    profiles: normalizeProfileRelation(documentRow.profiles)
  } as TransactionDocument;
  const context = await getTransactionDocumentContext(document.entity_name, document.entity_id);
  const permission = canAccessDocumentRoute(profile, context, document);
  if (!permission.allowed) {
    console.warn("documentDownload permission denied", {
      action: "documentDownload",
      documentId,
      entityName: document.entity_name,
      entityId: document.entity_id,
      branchId: context?.branchId ?? document.branch_id ?? null,
      bankAccountId: context?.bankAccountId ?? document.bank_account_id ?? null,
      userId: profile.id,
      userRole: normalizeRole(profile.role),
      userBranchId: profile.branch_id ?? null,
      permissionResult: permission.reason
    });
    return new Response("You do not have permission to access this document.", { status: 403 });
  }

  const bucketName = documentBucketForEntity(document.entity_name);
  if (!document.file_path?.trim()) {
    console.error("documentDownload missing file path", {
      action: "documentDownload",
      documentId,
      entityName: document.entity_name,
      entityId: document.entity_id,
      bucketName,
      userId: profile.id,
      userRole: normalizeRole(profile.role),
      userBranchId: profile.branch_id ?? null,
      metadataFound: true,
      storagePathEmpty: true
    });
    return new Response("Document link could not be created.", { status: 403 });
  }

  const pathCandidates = candidateStoragePaths(document.file_path, bucketName);
  let signedUrl: string | null = null;
  let lastError: { code?: string; message?: string; details?: string; hint?: string } | null = null;

  for (const storagePath of pathCandidates) {
    const { data, error } = await adminSupabase.storage
      .from(bucketName)
      .createSignedUrl(storagePath, 60, download ? { download: document.file_name } : undefined);

    if (!error && data?.signedUrl) {
      signedUrl = data.signedUrl;
      break;
    }

    lastError = {
      code: error?.name,
      message: error?.message,
      details: undefined,
      hint: undefined
    };
  }

  if (!signedUrl) {
    console.error("documentDownload signed URL failed", {
      action: "documentDownload",
      documentId,
      entityType: document.entity_name,
      entityId: document.entity_id,
      bucketName,
      storagePath: document.file_path,
      attemptedPaths: pathCandidates,
      userId: profile.id,
      userRole: normalizeRole(profile.role),
      userBranchId: profile.branch_id ?? null,
      metadataFound: true,
      storagePathEmpty: false,
      permissionResult: permission.reason,
      bankPermissionCount: (await getCurrentBankAccountPermissions(profile)).length,
      supabaseErrorCode: lastError?.code ?? null,
      supabaseErrorMessage: lastError?.message ?? null
    });
    if (lastError?.message?.toLowerCase().includes("not found")) {
      return new Response("File not found in storage.", { status: 404 });
    }
    return new Response("Document link could not be created.", { status: 403 });
  }

  return Response.redirect(signedUrl, 302);
}
