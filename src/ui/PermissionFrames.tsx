import { useEffect, useState } from "react";

import { confirmationContent } from "../core/confirmations/content";
import type { ConfirmationRequest } from "../core/native/bridge";
import type { Locale, MessageKey } from "../i18n/messages";
import { translate } from "../i18n/messages";
import { answerConfirmation, onConfirmationRequest, pendingConfirmations } from "../confirm/confirmBridge";
import { addRequest, removeRequest } from "../confirm/queue";
import { ConfirmationCard, type ConfirmationAnswer } from "./PresentedContentView";

/** Délai pendant lequel la réponse reste affichée avant que la demande ne quitte la liste. */
const STATUS_DELAY_MS = 1200;

/**
 * Demandes d'autorisation, dans un cadre de l'interface, comme une fenêtre : une par demande, avec tous ses paramètres.
 * Une réponse part au natif, qui la vérifie. Fermer le cadre refuse la demande.
 */
export function PermissionFrames({ locale }: { locale: Locale }) {
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

  if (queue.length === 0) return null;
  return (
    <div className="permission-frames">
      {queue.map((request) => {
        const content = confirmationContent(request, locale);
        return (
          <section key={request.id} className="float-window permission-frame" aria-label={content.title}>
            <header>
              <span>{content.title}</span>
              <button
                type="button"
                className="icon-button"
                onClick={() => void answer(request.id, false)}
                aria-label={t("confirm.refuse")}
              >
                ×
              </button>
            </header>
            <div className="body">
              <ConfirmationCard content={content} onAnswer={answer} t={t} />
            </div>
          </section>
        );
      })}
    </div>
  );
}
