import { formatDateTime } from "@/lib/format";
import { shortId } from "@/lib/display";
import type { ReactNode } from "react";

type FinanceRecordDetailsProps = {
  enteredBy?: ReactNode;
  originalSummary: string;
  recordId: string;
  status: "Active" | "Voided";
  voidReason?: string | null;
  voidedAt?: string | null;
  voidedBy?: ReactNode;
};

function detailValue(value: ReactNode) {
  return value === null || value === undefined || value === "" ? "-" : value;
}

export function FinanceRecordDetails({
  enteredBy,
  originalSummary,
  recordId,
  status,
  voidReason,
  voidedAt,
  voidedBy
}: FinanceRecordDetailsProps) {
  return (
    <details className="manual-bank-editor">
      <summary>View details</summary>
      <div className="record-detail-card">
        <div className="record-summary">
          <strong>{originalSummary}</strong>
          <span className="table-subtext">Record ID: {shortId(recordId)}</span>
        </div>
        <div className="record-detail-grid">
          <div>
            <strong>Status</strong>
            <span>{status}</span>
          </div>
          {enteredBy ? (
            <div>
              <strong>Entered by</strong>
              <span>{detailValue(enteredBy)}</span>
            </div>
          ) : null}
          {status === "Voided" ? (
            <>
              <div>
                <strong>Voided by</strong>
                <span>{detailValue(voidedBy)}</span>
              </div>
              <div>
                <strong>Voided at</strong>
                <span>{formatDateTime(voidedAt)}</span>
              </div>
              <div>
                <strong>Void reason</strong>
                <span>{detailValue(voidReason)}</span>
              </div>
              <div>
                <strong>Original record summary</strong>
                <span>{originalSummary}</span>
              </div>
            </>
          ) : null}
        </div>
      </div>
    </details>
  );
}
