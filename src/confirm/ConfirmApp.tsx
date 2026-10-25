import { useEffect, useState } from "react";

import { confirmationContent } from "../core/confirmations/content";
import type { ConfirmationRequest } from "../core/native/bridge";
import type { Locale, MessageKey } from "../i18n/messages";
import { translate } from "../i18n/messages";
import { ConfirmationCard, type ConfirmationAnswer } from "../ui/PresentedContentView";
import { answerConfirmation, onConfirmationRequest, pendingConfirmations } from "./confirmBridge";
import { addRequest, removeRequest } from "./queue";

/** Délai pendant lequel la réponse reste affichée avant que la demande ne quitte la liste. */
const STATUS_DELAY_MS = 1200;

/**
 * Fenêtre de confirmation : une carte par demande, avec tous ses paramètres. Une réponse part au natif, qui la vérifie.
 * La fenêtre n'a pas d'autre rôle : elle ne lance aucune action.
 */
export function ConfirmApp({ locale }: { locale: Locale }) {
  const [queue, setQueue] = useState<ConfirmationRequest[]>([]);
  const t = (key: MessageKey) => translate(locale, key);

  useEffect(() => {
    const stop = onConfirmationRequest((request) => setQueue((current) => addRequest(current, request)));
    pendingConfirmations()
      .then((pending) => setQueue((current) => pending.reduce((acc, request) => addRequest(acc, request), current)))
      .catch(() => {});
    return stop;
  }, []);

  const answer: ConfirmationAnswer = async (id, approved, remember) => {
    try {
      await answerConfirmation(id, approved, remember);
    } finally {
      window.setTimeout(() => setQueue((current) => removeRequest(current, id)), STATUS_DELAY_MS);
    }
  };

  if (queue.length === 0) {
    return <p className="confirm-empty">{t("confirm.none")}</p>;
  }
  return (
    <div className="confirm-queue">
      {queue.map((request) => {
        const content = confirmationContent(request, locale);
        return (
          <section key={request.id} className="confirm-request" aria-label={content.title}>
            <h2>{content.title}</h2>
            <ConfirmationCard content={content} onAnswer={answer} t={t} />
          </section>
        );
      })}
    </div>
  );
}
