import { Download } from "lucide-react";

type ExportCsvLinkProps = {
  label?: string;
  report: string;
  searchParams?: Record<string, string | string[] | undefined>;
};

function exportHref(report: string, searchParams: ExportCsvLinkProps["searchParams"]) {
  const query = new URLSearchParams();

  Object.entries(searchParams ?? {}).forEach(([key, value]) => {
    if (Array.isArray(value)) {
      value.forEach((item) => query.append(key, item));
      return;
    }

    if (value) query.set(key, value);
  });

  const queryString = query.toString();
  const suffix = queryString ? `?${queryString}` : "";
  return `/exports/${report}${suffix}`;
}

export function ExportCsvLink({ label = "Export CSV", report, searchParams }: ExportCsvLinkProps) {
  return (
    <a className="ghost-button export-csv-link" href={exportHref(report, searchParams)}>
      <Download aria-hidden="true" size={16} />
      {label}
    </a>
  );
}
