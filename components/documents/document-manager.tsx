"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import Image from "next/image";
import { useRouter } from "next/navigation";
import { deleteTransactionDocument, uploadTransactionDocument } from "@/app/document-actions";
import { byteSize, userDisplayLabel } from "@/lib/display";
import { documentUploadLabel } from "@/lib/transaction-document-config";
import type { TransactionDocument, TransactionDocumentEntityName, TransactionDocumentUploadResult } from "@/lib/types";

const imageTypes = new Set(["image/jpeg", "image/png", "image/webp"]);
const maxUploadSizeBytes = 10 * 1024 * 1024;
const optimizationTriggerBytes = 1024 * 1024;
const imageOptimizationMaxDimension = 1800;
const optimizedImageQuality = 0.78;

const documentTypes = [
  { label: "Receipt", value: "receipt" },
  { label: "Invoice", value: "invoice" },
  { label: "Payment proof", value: "payment_proof" },
  { label: "Bank slip", value: "bank_slip" },
  { label: "Claim document", value: "claim_document" },
  { label: "Supporting document", value: "supporting_document" },
  { label: "Other", value: "other" }
];

type DocumentManagerProps = {
  canDelete?: boolean;
  documents: TransactionDocument[];
  entityId: string;
  entityName: TransactionDocumentEntityName;
};

function dateTime(value: string) {
  return new Intl.DateTimeFormat("en-MY", {
    dateStyle: "medium",
    timeStyle: "short"
  }).format(new Date(value));
}

function documentTypeLabel(value: string | null | undefined) {
  return value?.replaceAll("_", " ") ?? "supporting document";
}

function documentStatusLabel(count: number) {
  if (count <= 0) return "No document";
  if (count === 1) return "Uploaded";
  return `${count} documents`;
}

type OptimizationResult = {
  file: File;
  message?: string | null;
  originalSize: number;
};

function fileExtension(name: string) {
  const match = name.match(/\.([^.]+)$/);
  return match?.[1]?.toLowerCase() ?? null;
}

function replaceFileExtension(name: string, nextExtension: string) {
  const cleanExtension = nextExtension.replace(/^\./, "");
  return name.replace(/\.[^.]+$/, "") + `.${cleanExtension}`;
}

async function optimizeUploadFile(file: File): Promise<OptimizationResult> {
  if (file.size > maxUploadSizeBytes) {
    throw new Error("File is too large. Maximum allowed size is 10MB.");
  }

  if (file.size <= optimizationTriggerBytes) {
    return { file, originalSize: file.size };
  }

  if (!imageTypes.has(file.type)) {
    const extension = fileExtension(file.name);
    if (extension === "pdf") {
      // Browser-safe PDF compression is not reliable here, so we keep readable PDFs intact.
      return {
        file,
        originalSize: file.size,
        message: "Could not reduce file size, uploaded original file."
      };
    }
    return {
      file,
      originalSize: file.size,
      message: "Could not reduce file size, uploaded original file."
    };
  }

  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, imageOptimizationMaxDimension / Math.max(bitmap.width, bitmap.height));
  const width = Math.max(1, Math.round(bitmap.width * scale));
  const height = Math.max(1, Math.round(bitmap.height * scale));
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d");
  if (!context) {
    bitmap.close();
    return {
      file,
      originalSize: file.size,
      message: "Could not reduce file size, uploaded original file."
    };
  }
  context.drawImage(bitmap, 0, 0, width, height);
  bitmap.close();

  const outputMimeType = file.type === "image/png" ? "image/jpeg" : file.type;
  const blob = await new Promise<Blob | null>((resolve) => {
    canvas.toBlob((value) => resolve(value), outputMimeType, optimizedImageQuality);
  });

  if (!blob) {
    return {
      file,
      originalSize: file.size,
      message: "Could not reduce file size, uploaded original file."
    };
  }

  const optimizedFile = new File(
    [blob],
    outputMimeType === "image/jpeg" ? replaceFileExtension(file.name, "jpg") : file.name,
    { type: outputMimeType }
  );

  if (optimizedFile.size >= file.size || optimizedFile.size > maxUploadSizeBytes) {
    return {
      file,
      originalSize: file.size,
      message: "Could not reduce file size, uploaded original file."
    };
  }

  return {
    file: optimizedFile,
    originalSize: file.size,
    message: `File optimized from ${byteSize(file.size)} to ${byteSize(optimizedFile.size)}.`
  };
}

function isImage(document: TransactionDocument) {
  return Boolean(document.mime_type && imageTypes.has(document.mime_type));
}

function isUploadResult(value: unknown): value is TransactionDocumentUploadResult {
  return Boolean(
    value &&
      typeof value === "object" &&
      "ok" in value &&
      typeof (value as { ok?: unknown }).ok === "boolean" &&
      "message" in value &&
      typeof (value as { message?: unknown }).message === "string"
  );
}

export function DocumentManager({ canDelete = false, documents, entityId, entityName }: DocumentManagerProps) {
  const router = useRouter();
  const fileInput = useRef<HTMLInputElement>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [messageTone, setMessageTone] = useState<"success" | "error" | null>(null);
  const [localDocuments, setLocalDocuments] = useState(documents);
  const [lastUploadedFiles, setLastUploadedFiles] = useState<string[]>([]);
  const [isViewDocumentsOpen, setIsViewDocumentsOpen] = useState(false);
  const [isPending, startTransition] = useTransition();
  const visibleDocumentCount = localDocuments.length;
  const status = documentStatusLabel(visibleDocumentCount);
  const uploadLabel = documentUploadLabel(entityName);

  useEffect(() => {
    setLocalDocuments((currentDocuments) => {
      if (!lastUploadedFiles.length) return documents;

      const knownIds = new Set(documents.map((document) => document.id));
      const optimisticDocuments = currentDocuments.filter((document) => !knownIds.has(document.id));
      return [...optimisticDocuments, ...documents];
    });
    if (documents.length) {
      setLastUploadedFiles([]);
    }
  }, [documents, lastUploadedFiles.length]);

  useEffect(() => {
    if (visibleDocumentCount > 0 && lastUploadedFiles.length) {
      setIsViewDocumentsOpen(true);
    }
  }, [documents]);

  async function uploadSelectedDocuments(formData: FormData) {
    const selectedFiles = fileInput.current?.files ? Array.from(fileInput.current.files) : [];
    if (!selectedFiles.length) {
      setMessageTone("error");
      setMessage("Choose at least one document.");
      return;
    }

    setMessage(null);
    setMessageTone(null);
    try {
      const uploadedFileNames: string[] = [];
      const uploadedDocuments: TransactionDocument[] = [];
      const uploadMessages: string[] = [];
      for (const file of selectedFiles) {
        if (file.size > maxUploadSizeBytes) {
          throw new Error("File is too large. Maximum allowed size is 10MB.");
        }
        if (file.size > optimizationTriggerBytes) {
          setMessageTone(null);
          setMessage(`Optimizing file before upload... (${file.name})`);
        }
        const { file: preparedFile, originalSize, message: optimizationMessage } = await optimizeUploadFile(file);
        const uploadData = new FormData();
        uploadData.set("entity_name", entityName);
        uploadData.set("entity_id", entityId);
        uploadData.set("document_type", String(formData.get("document_type") ?? ""));
        uploadData.set("notes", String(formData.get("notes") ?? ""));
        uploadData.set("original_size_bytes", String(originalSize));
        uploadData.set("compressed_size_bytes", String(preparedFile.size));
        uploadData.set("file", preparedFile);
        const result = await uploadTransactionDocument(uploadData);
        if (!isUploadResult(result)) {
          console.error("uploadTransactionDocument returned unexpected shape", {
            entityId,
            entityName,
            result
          });
          throw new Error("An unexpected response was received from the server.");
        }
        if (!result.ok) {
          throw new Error(result.message);
        }
        uploadedFileNames.push(file.name);
        uploadedDocuments.push(result.document);
        if (optimizationMessage) {
          uploadMessages.push(`${file.name}: ${optimizationMessage}`);
        }
      }
      if (fileInput.current) fileInput.current.value = "";
      if (uploadedDocuments.length) {
        setLocalDocuments((currentDocuments) => {
          const existingIds = new Set(currentDocuments.map((document) => document.id));
          const uniqueUploads = uploadedDocuments.filter((document) => !existingIds.has(document.id));
          return [...uniqueUploads, ...currentDocuments];
        });
      }
      setLastUploadedFiles(uploadedFileNames);
      setIsViewDocumentsOpen(true);
      setMessageTone("success");
      setMessage(uploadMessages.length ? uploadMessages.join(" ") : uploadedFileNames.length > 1 ? "Documents uploaded." : "Document uploaded.");
      startTransition(() => router.refresh());
    } catch (error) {
      setMessageTone("error");
      setMessage(error instanceof Error ? error.message : "Document upload failed.");
    }
  }

  return (
    <div className="document-manager">
      <span className={`status-pill ${visibleDocumentCount ? "status-paid" : "status-unpaid"}`}>{status}</span>
      <div className="document-actions">
        <details className="document-action">
          <summary className="ghost-button compact-button">{uploadLabel}</summary>
          <div className="document-panel">
            <form action={uploadSelectedDocuments} className="document-upload-form">
              <strong>{uploadLabel}</strong>
              <label>
                Document type
                <select defaultValue="supporting_document" name="document_type">
                  {documentTypes.map((type) => (
                    <option key={type.value} value={type.value}>
                      {type.label}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Files
                <input accept="application/pdf,image/png,image/jpeg,image/webp,.pdf,.png,.jpg,.jpeg,.webp" multiple name="files" ref={fileInput} type="file" />
              </label>
              <label>
                Notes
                <textarea name="notes" placeholder="Optional document note" />
              </label>
              <button className="primary-button compact-button" disabled={isPending} type="submit">
                {isPending ? "Uploading..." : uploadLabel}
              </button>
              {message ? <p className={`document-message ${messageTone === "error" ? "error-copy" : ""}`}>{message}</p> : null}
              {lastUploadedFiles.length ? (
                <p className="document-message">Uploaded file{lastUploadedFiles.length > 1 ? "s" : ""}: {lastUploadedFiles.join(", ")}</p>
              ) : null}
            </form>
          </div>
        </details>

        <details
          className="document-action"
          onToggle={(event) => setIsViewDocumentsOpen(event.currentTarget.open)}
          open={isViewDocumentsOpen}
        >
          <summary className="ghost-button compact-button">View Documents</summary>
          <div className="document-panel">
            <div className="document-list">
              {localDocuments.length ? localDocuments.map((document) => (
                <article className="document-item" key={document.id}>
                  {isImage(document) ? (
                    <a href={`/documents/${document.id}/download`} target="_blank" rel="noreferrer">
                      {/* Signed download route keeps storage private. */}
                      <Image
                        alt={document.file_name}
                        className="document-preview"
                        height={160}
                        src={`/documents/${document.id}/download`}
                        unoptimized
                        width={220}
                      />
                    </a>
                  ) : null}
                  <div className="document-meta">
                    <strong>{document.file_name}</strong>
                    <span>{documentTypeLabel(document.document_type)}</span>
                    <span>{dateTime(document.created_at)}</span>
                    <span>
                      {document.compressed_size_bytes
                        ? `Stored ${byteSize(document.compressed_size_bytes)}`
                        : `File size ${byteSize(document.file_size_bytes)}`}
                    </span>
                    <span>Uploaded by {userDisplayLabel(document.profiles, document.uploaded_by)}</span>
                  </div>
                  <div className="document-links">
                    <a className="ghost-button compact-button" href={`/documents/${document.id}/download`} target="_blank" rel="noreferrer">
                      {document.mime_type === "application/pdf" ? "Open PDF" : "View document"}
                    </a>
                    <a className="ghost-button compact-button" href={`/documents/${document.id}/download?download=1`}>
                      Download document
                    </a>
                  </div>
                  {canDelete ? (
                    <details className="document-delete">
                      <summary>Delete document</summary>
                      <form action={deleteTransactionDocument}>
                        <input name="document_id" type="hidden" value={document.id} />
                        <label>
                          Delete reason
                          <textarea name="delete_reason" required />
                        </label>
                        <button className="primary-button compact-button" type="submit">
                          Remove document
                        </button>
                      </form>
                    </details>
                  ) : null}
                </article>
              )) : lastUploadedFiles.length ? (
                <p className="muted-copy">Refreshing document list for: {lastUploadedFiles.join(", ")}</p>
              ) : <p className="muted-copy">No document uploaded.</p>}
            </div>
          </div>
        </details>
      </div>
    </div>
  );
}
