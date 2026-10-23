import { useState } from "react";

import type { PresentedContent } from "../core/presentation/types";
import type { MessageKey } from "../i18n/messages";

export type ConfirmationAnswer = (id: string, approved: boolean) => Promise<void>;

function ConfirmationCard({
  content,
  onAnswer,
  t,
}: {
  content: Extract<PresentedContent, { kind: "confirmation" }>;
  onAnswer: ConfirmationAnswer;
  t: (key: MessageKey) => string;
}) {
  const [state, setState] = useState<"pending" | "sending" | "approved" | "refused" | "failed">("pending");

  const answer = async (approved: boolean) => {
    setState("sending");
    try {
      await onAnswer(content.requestId, approved);
      setState(approved ? "approved" : "refused");
    } catch {
      // Demande expirée ou déjà réglée : le natif refuse, l'interface l'affiche.
      setState("failed");
    }
  };

  return (
    <div className="confirmation">
      <dl className="info-card">
        {content.rows.map((row, index) => (
          <div key={`${index}-${row.label}`} className={row.value.length > 40 ? "stacked" : undefined}>
            <dt>{row.label}</dt>
            <dd>{row.value}</dd>
          </div>
        ))}
      </dl>
      {state === "pending" || state === "sending" ? (
        <div className="confirm-actions">
          <button type="button" className="send" disabled={state === "sending"} onClick={() => void answer(true)}>
            {content.approve}
          </button>
          <button type="button" className="chip" disabled={state === "sending"} onClick={() => void answer(false)}>
            {content.refuse}
          </button>
        </div>
      ) : (
        <p className={`confirm-status ${state}`} role="status">
          {state === "approved" && t("confirm.status.approved")}
          {state === "refused" && t("confirm.status.refused")}
          {state === "failed" && t("confirm.status.failed")}
        </p>
      )}
    </div>
  );
}

export function PresentedContentView({
  content,
  onAnswer,
  t,
}: {
  content: PresentedContent;
  onAnswer?: ConfirmationAnswer;
  t: (key: MessageKey) => string;
}) {
  switch (content.kind) {
    case "information-card":
      return (
        <dl className="info-card">
          {content.rows.map((row, index) => (
            // Les valeurs longues (chemins, empreintes, notes) passent sous le libellé pour rester lisibles.
            <div key={`${index}-${row.label}`} className={row.value.length > 40 ? "stacked" : undefined}>
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
    case "confirmation":
      return <ConfirmationCard content={content} onAnswer={onAnswer ?? (async () => {})} t={t} />;
  }
}
