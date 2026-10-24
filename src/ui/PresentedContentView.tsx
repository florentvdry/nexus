import { useState } from "react";

import type { PresentedContent } from "../core/presentation/types";
import type { MessageKey } from "../i18n/messages";

export type ConfirmationAnswer = (id: string, approved: boolean, remember?: boolean) => Promise<void>;

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
  const [remember, setRemember] = useState(false);

  const answer = async (approved: boolean) => {
    setState("sending");
    try {
      // La règle n'est demandée que pour une approbation : le natif ignore le reste.
      await onAnswer(content.requestId, approved, approved && remember);
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
      {content.remember && (state === "pending" || state === "sending") && (
        <label className="field toggle">
          <input type="checkbox" checked={remember} disabled={state === "sending"} onChange={(event) => setRemember(event.target.checked)} />
          {content.remember.label}
        </label>
      )}
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
    case "news-list":
      return (
        <div className="news-list">
          <ul>
            {content.items.map((item, index) => (
              <li key={index}>
                <span>{item.text}</span>
              </li>
            ))}
          </ul>
          <p className="field-hint">{content.source}</p>
        </div>
      );
    case "image-card":
      return (
        <figure className="image-card">
          <img src={content.imageUrl} alt={content.title} />
          <figcaption>
            <span>{content.credit}</span> · <span>{content.license}</span>
          </figcaption>
          <p className="field-hint">{content.page}</p>
        </figure>
      );
    case "article-card":
      return (
        <article className="article-card">
          <p>{content.extract}</p>
          <p className="field-hint">{content.page}</p>
        </article>
      );
    case "confirmation":
      return <ConfirmationCard content={content} onAnswer={onAnswer ?? (async () => {})} t={t} />;
  }
}
