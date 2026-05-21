export type ParsedCsv = {
  headers: string[];
  rows: Record<string, string>[];
};

export type CsvCell = boolean | number | string | null | undefined;

export function normalizeHeader(header: string) {
  return header.trim().toLowerCase().replace(/[\s-]+/g, "_");
}

export function normalizeValue(value: string) {
  return value.trim().toLowerCase().replace(/[\s-]+/g, "_");
}

export function parseCsv(input: string): ParsedCsv {
  const records: string[][] = [];
  let current = "";
  let row: string[] = [];
  let inQuotes = false;

  for (let index = 0; index < input.length; index += 1) {
    const char = input[index];
    const next = input[index + 1];

    if (char === '"' && inQuotes && next === '"') {
      current += '"';
      index += 1;
      continue;
    }

    if (char === '"') {
      inQuotes = !inQuotes;
      continue;
    }

    if (char === "," && !inQuotes) {
      row.push(current.trim());
      current = "";
      continue;
    }

    if ((char === "\n" || char === "\r") && !inQuotes) {
      if (char === "\r" && next === "\n") index += 1;
      row.push(current.trim());
      if (row.some((cell) => cell.length > 0)) records.push(row);
      row = [];
      current = "";
      continue;
    }

    current += char;
  }

  row.push(current.trim());
  if (row.some((cell) => cell.length > 0)) records.push(row);

  const [headerRow, ...dataRows] = records;
  if (!headerRow) return { headers: [], rows: [] };

  const headers = headerRow.map(normalizeHeader);
  const rows = dataRows.map((cells) =>
    Object.fromEntries(headers.map((header, index) => [header, cells[index]?.trim() ?? ""]))
  );

  return { headers, rows };
}

function csvCell(value: CsvCell) {
  const text = String(value ?? "");
  return /[",\n\r]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

export function stringifyCsv(headers: string[], rows: CsvCell[][]) {
  return [headers, ...rows].map((row) => row.map(csvCell).join(",")).join("\n");
}
