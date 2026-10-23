import type { PresentedContent } from "../core/presentation/types";

export function PresentedContentView({ content }: { content: PresentedContent }) {
  switch (content.kind) {
    case "information-card":
      return (
        <dl className="info-card">
          {content.rows.map((row) => (
            <div key={row.label}>
              <dt>{row.label}</dt>
              <dd>{row.value}</dd>
            </div>
          ))}
        </dl>
      );
    case "data-table":
      return (
        <table className="data-table">
          <thead>
            <tr>
              {content.columns.map((column) => (
                <th key={column} scope="col">
                  {column}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {content.rows.map((row, rowIndex) => (
              <tr key={`${rowIndex}-${row[0]}`}>
                {row.map((cell, cellIndex) => (
                  <td key={cellIndex}>{cell}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      );
    case "error-card":
      return (
        <p className="error-card" role="alert">
          <code>{content.code}</code>
          <span>{content.message}</span>
        </p>
      );
  }
}
