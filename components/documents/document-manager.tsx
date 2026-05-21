"use client";

import { useRef, useState, useTransition } from "react";
import Image from "next/image";
import { useRouter } from "next/navigation";
import { deleteTransactionDocument, uploadTransactionDocument } from "@/app/document-actions";
import { byteSize, userDisplayLabel } from "@/lib/display";
import type { TransactionDocument, TransactionDocumentEntityName } from "@/lib/types";

const imageTypes = new Set(["image/jpeg", "image/png", "image/webp"]);

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

function extensionlessName(name: string) {
  return name.replace(/\.[^.]+$/, "");
}

function dateTime(value: string) {
  return new Intl.DateTimeFormat("en-MY", {
    dateStyle: "medium",
    timeStyle: "short"
  }).format(new Date(value));
}

function documentStatusLabel(count: number) {
  if (count <= 0) return "No document";
  if (count === 1) return "Uploaded";
  return `${count} documents`;
}

async function compressImage(file: File) {
  if (!imageTypes.has(file.type)) {
    return { compressed: file, originalSize: file.size };
  }

  const bitmap = await createImageBitmap(file);
  const maxDimension = 1600;
  const scale = Math.min(1, maxDimension / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(bitmap.width * scale));
  canvas.height = Math.max(1, Math.round(bitmap.height * scale));
  const context = canvas.getContext("2d");
  if (!context) throw new Error("Image compression is unavailable in this browser.");
  context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();

  const blob = await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((value) => {
      if (value) resolve(value);
      else reject(new Error("Image compression failed."));
    }, "image/webp", 0.7);
  });

  return {
    compressed: new File([blob], `${extensionlessName(file.name)}.webp`, { type: "image/webp" }),
    originalSize: file.size
  };
}

function isImage(document: TransactionDocument) {
  return Boolean(document.mime_type && imageTypes.has(document.mime_type));
}

export function DocumentManager({ canDelete = false, documents, entityId, entityName }: DocumentManagerProps) {
  const router = useRouter();
  const fileInput = useRef<HTMLInputElement>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const status = documentStatusLabel(documents.length);

  async function uploadSelectedDocuments(formData: FormData) {
    const selectedFiles = fileInput.current?.files ? Array.from(fileInput.current.files) : [];
    if (!selectedFiles.length) {
      setMessage("Choose at least one document.");
      return;
    }

    setMessage(null);
    try {
      for (const file of selectedFiles) {
        const { compressed, originalSize } = await compressImage(file);
        const uploadData = new FormData();
        uploadData.set("entity_name", entityName);
        uploadData.set("entity_id", entityId);
        uploadData.set("document_type", String(formData.get("document_type") ?? ""));
        uploadData.set("notes", String(formData.get("notes") ?? ""));
        uploadData.set("original_size_bytes", String(originalSize));
        uploadData.set("compressed_size_bytes", String(compressed.size));
        uploadData.set("file", compressed);
        await uploadTransactionDocument(uploadData);
      }
      if (fileInput.current) fileInput.current.value = "";
      setMessage("Document uploaded.");
      startTransition(() => router.refresh());
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Document upload failed.");
    }
  }

  return (
    <div className="document-manager">
      <span className={`status-pill ${documents.length ? "status-paid" : "status-unpaid"}`}>{status}</span>
      <div className="document-actions">
        <details className="document-action">
          <summary className="ghost-button compact-button">Upload Document</summary>
          <div className="document-panel">
            <form action={uploadSelectedDocuments} className="document-upload-form">
              <strong>Upload document</strong>
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
                <input accept="application/pdf,image/jpeg,image/png,image/webp" multiple name="files" ref={fileInput} type="file" />
              </label>
              <label>
                Notes
                <textarea name="notes" placeholder="Optional document note" />
              </label>
              <button className="primary-button compact-button" disabled={isPending} type="submit">
                Upload document
              </button>
              {message ? <p className="document-message">{message}</p> : null}
            </form>
          </div>
        </details>

        <details className="document-action">
          <summary className="ghost-button compact-button">View Documents</summary>
          <div className="document-panel">
            <div className="document-list">
              {documents.length ? documents.map((document) => (
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
                    <span>{document.document_type?.replaceAll("_", " ") ?? "supporting document"}</span>
                    <span>Uploaded by {userDisplayLabel(document.profiles, document.uploaded_by)}</span>
                    <span>{dateTime(document.created_at)}</span>
                    <span>Original {byteSize(document.file_size_bytes)} / stored {byteSize(document.compressed_size_bytes)}</span>
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
              )) : <p className="muted-copy">No document uploaded.</p>}
            </div>
          </div>
        </details>
      </div>
    </div>
  );
}
