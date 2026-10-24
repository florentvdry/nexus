import { useState } from "react";

import type { MessageKey } from "../i18n/messages";
import { readAgendaPath, writeAgendaPath } from "./agendaSettings";

interface AgendaSectionProps {
  t: (key: MessageKey, params?: Record<string, string | number>) => string;
}

/** Réglage de l'agenda : le chemin d'un fichier .ics. NEXUS ne modifie jamais ce fichier. */
export function AgendaSection({ t }: AgendaSectionProps) {
  const [path, setPath] = useState(() => readAgendaPath() ?? "");
  const [saved, setSaved] = useState(false);

  return (
    <section className="agenda" aria-label={t("agenda.settings")}>
      <h3>{t("agenda.settings")}</h3>
      <p className="field-hint">{t("agenda.hint")}</p>
      <label className="field">
        <span>{t("agenda.pathLabel")}</span>
        <input
          type="text"
          value={path}
          spellCheck={false}
          onChange={(event) => {
            setPath(event.target.value);
            setSaved(false);
          }}
        />
      </label>
      <button
        type="button"
        className="chip"
        onClick={() => {
          writeAgendaPath(path);
          setSaved(true);
        }}
      >
        {t("agenda.save")}
      </button>
      {saved && (
        <p className="field-hint" role="status">
          {t("agenda.saved")}
        </p>
      )}
    </section>
  );
}
