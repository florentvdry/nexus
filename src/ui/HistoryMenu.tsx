import { useState } from "react";

import type { HistoryEntry } from "../core/presentation/windows";
import type { MessageKey } from "../i18n/messages";

const REASON_KEY: Record<HistoryEntry["reason"], MessageKey> = {
  closed: "history.closed",
  evicted: "history.evicted",
  "no-space": "history.noSpace",
};

interface HistoryMenuProps {
  history: HistoryEntry[];
  t: (key: MessageKey) => string;
  onReopen: (id: string) => void;
}

/** Accès discret aux résultats précédents : n'apparaît que s'il existe des résultats à rouvrir. */
export function HistoryMenu({ history, t, onReopen }: HistoryMenuProps) {
  const [open, setOpen] = useState(false);
  if (history.length === 0) return null;

  return (
    <div className="history">
      <button type="button" className="chip" aria-expanded={open} onClick={() => setOpen((value) => !value)}>
        {t("ui.history")} ({history.length})
      </button>
      {open && (
        <ul className="history-menu">
          {history.map((entry) => (
            <li key={entry.id}>
              <span>
                {entry.content.title}
                <small>{t(REASON_KEY[entry.reason])}</small>
              </span>
              <button
                type="button"
                className="chip"
                onClick={() => {
                  onReopen(entry.id);
                  setOpen(false);
                }}
              >
                {t("ui.historyReopen")}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
