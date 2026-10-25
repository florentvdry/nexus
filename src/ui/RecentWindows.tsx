import type { HistoryEntry } from "../core/presentation/windows";
import type { MessageKey } from "../i18n/messages";

const REASON_KEY: Record<HistoryEntry["reason"], MessageKey> = {
  closed: "history.closed",
  evicted: "history.evicted",
  "no-space": "history.noSpace",
};

interface RecentWindowsProps {
  history: HistoryEntry[];
  t: (key: MessageKey) => string;
  onReopen: (id: string) => void;
}

/** Résultats fermés pendant la session, rouvrables d'un clic. Rien n'est affiché s'il n'y en a aucun. */
export function RecentWindows({ history, t, onReopen }: RecentWindowsProps) {
  if (history.length === 0) return null;

  return (
    <section className="aside-section" aria-label={t("conversation.recent")}>
      <h2>{t("conversation.recent")}</h2>
      <ul className="recent-list">
        {history.map((entry) => (
          <li key={entry.id}>
            <span>
              {entry.content.title}
              <small>{t(REASON_KEY[entry.reason])}</small>
            </span>
            <button type="button" className="text-button" onClick={() => onReopen(entry.id)}>
              {t("ui.historyReopen")}
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}
