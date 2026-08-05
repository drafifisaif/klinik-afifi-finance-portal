type DataTableProps = {
  columns: string[];
  emptyMessage?: string;
  rows: (string | number | React.ReactNode)[][];
  rowKeys?: (string | number)[];
};

export function DataTable({ columns, emptyMessage = "No records yet.", rows, rowKeys }: DataTableProps) {
  return (
    <div className="table-wrap">
      <table>
        <thead>
          <tr>
            {columns.map((column) => (
              <th key={column}>{column}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.length ? (
            rows.map((row, rowIndex) => (
              <tr key={rowKeys?.[rowIndex] ?? rowIndex}>
                {row.map((cell, cellIndex) => (
                  <td key={`${rowKeys?.[rowIndex] ?? rowIndex}-${cellIndex}`}>{cell}</td>
                ))}
              </tr>
            ))
          ) : (
            <tr>
              <td colSpan={columns.length}>{emptyMessage}</td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
