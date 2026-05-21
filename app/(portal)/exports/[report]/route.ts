import { stringifyCsv } from "@/lib/csv";
import {
  auditTrailCsv,
  bankMovementCsv,
  cashInHandCsv,
  dailySalesCsv,
  dashboardSummaryCsv,
  expensesCsv,
  ExportForbiddenError,
  pettyCashLedgerCsv
} from "@/lib/report-exports";

type ExportRouteProps = {
  params: Promise<{ report: string }>;
};

const exportHandlers = {
  audit: auditTrailCsv,
  bank: bankMovementCsv,
  "cash-in-hand": cashInHandCsv,
  dashboard: dashboardSummaryCsv,
  expenses: expensesCsv,
  "petty-cash": pettyCashLedgerCsv,
  sales: dailySalesCsv
} as const;

type ReportKey = keyof typeof exportHandlers;

function isReportKey(report: string): report is ReportKey {
  return Object.prototype.hasOwnProperty.call(exportHandlers, report);
}

export async function GET(request: Request, { params }: ExportRouteProps) {
  const { report } = await params;
  const searchParams = new URL(request.url).searchParams;

  if (!isReportKey(report)) {
    return new Response("Report export not found.", { status: 404 });
  }

  try {
    const exportFile = await exportHandlers[report](searchParams);

    return new Response(stringifyCsv(exportFile.headers, exportFile.rows), {
      headers: {
        "Cache-Control": "no-store",
        "Content-Disposition": `attachment; filename="${exportFile.filename}"`,
        "Content-Type": "text/csv; charset=utf-8"
      }
    });
  } catch (error) {
    if (error instanceof ExportForbiddenError) {
      return new Response(error.message, { status: 403 });
    }

    throw error;
  }
}
