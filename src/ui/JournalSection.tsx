import { useEffect, useState } from "react";

import type { JournalEntry, NativeBridge } from "../core/native/bridge";
import type { Locale, MessageKey } from "../i18n/messages";

/** Nombre de commandes affichées dans les réglages. */
const SHOWN = 20;

interface JournalSectionProps {
  bridge: NativeBridge;
  locale: Locale;
  t: (key: MessageKey, params?: Record<string, string | number>) => string;
}

/** Journal des commandes : désactivé par défaut, consultable et vidable depuis les réglages. */
export function JournalSection({ bridge, locale, t }: JournalSectionProps) {
  const [enabled, setEnabled] = useState(false);
  const [entries, setEntries] = useState<JournalEntry[]>([]);
  const [unavailable, setUnavailable] = useState(false);

  useEffect(() => {
    let current = true;
    bridge
      .journalStatus()
      .then(async (on) => {
        if (!current) return;
        setEnabled(on);
        if (on) setEntries(await bridge.listJournal(SHOWN));
      })
      .catch(() => {
        if (current) setUnavailable(true);
      });
    return () => {
      current = false;
    };
  }, [bridge]);

  const toggle = async (on: boolean) => {
    try {
      await bridge.setJournalEnabled(on);
      setEnabled(on);
      setEntries(on ? await bridge.listJournal(SHOWN) : []);
    } catch {
      setUnavailable(true);
    }
  };

  const clear = async () => {
    try {
      await bridge.clearJournal();
      setEntries([]);
    } catch {
      setUnavailable(true);
    }
  };

  return (
    <section className="journal" aria-label={t("journal.title")}>
      <h3>{t("journal.title")}</h3>
      {unavailable ? (
        <p className="field-hint">{t("journal.unavailable")}</p>
      ) : (
        <>
          <p className="field-hint">{t("journal.hint")}</p>
          <label className="field toggle">
            <input type="checkbox" checked={enabled} onChange={(event) => void toggle(event.target.checked)} />
            {t("journal.enable")}
          </label>
          {enabled && entries.length === 0 && <p className="field-hint">{t("journal.empty")}</p>}
          {enabled && entries.length > 0 && (
            <>
              <ul className="journal-entries">
                {entries.map((entry) => (
                  <li key={entry.id}>
                    <time dateTime={new Date(entry.at).toISOString()}>{new Date(entry.at).toLocaleString(locale)}</time>
                    <span>{entry.text}</span>
                  </li>
                ))}
              </ul>
              <button type="button" className="chip" onClick={() => void clear()}>
                {t("journal.clear")}
              </button>
            </>
          )}
        </>
      )}
    </section>
  );
}
