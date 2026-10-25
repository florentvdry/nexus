import { useState } from "react";

import type { MessageKey } from "../i18n/messages";
import { readObsidianVault, writeObsidianVault } from "./obsidian";

interface ObsidianSectionProps {
  t: (key: MessageKey, params?: Record<string, string | number>) => string;
}

/** Dossier du coffre Obsidian : mémoire et rapports y sont écrits sur demande, dans son sous-dossier NEXUS. */
export function ObsidianSection({ t }: ObsidianSectionProps) {
  const [vault, setVault] = useState<string>(() => readObsidianVault() ?? "");
  const [saved, setSaved] = useState<string | null>(() => readObsidianVault());
  return (
    <section className="accessibility" aria-label={t("obsidian.title")}>
      <h3>{t("obsidian.title")}</h3>
      <label className="field">
        {t("obsidian.label")}
        <input type="text" value={vault} placeholder="C:\Users\ana\Documents\Obsidian" onChange={(event) => setVault(event.target.value)} />
      </label>
      <p className="field-hint">{t("obsidian.hint")}</p>
      <button
        type="button"
        className="chip"
        onClick={() => {
          writeObsidianVault(vault);
          setSaved(readObsidianVault());
        }}
      >
        {t("obsidian.save")}
      </button>
      {saved && <p className="field-hint">{t("obsidian.current", { path: saved })}</p>}
    </section>
  );
}
