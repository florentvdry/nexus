import { useState } from "react";

import type { MessageKey } from "../i18n/messages";
import { applyLargeText, readLargeText } from "./textScale";

interface AccessibilitySectionProps {
  t: (key: MessageKey, params?: Record<string, string | number>) => string;
}

/** Réglages d'accessibilité : taille du texte. Le mouvement réduit suit déjà le système. */
export function AccessibilitySection({ t }: AccessibilitySectionProps) {
  const [large, setLarge] = useState(readLargeText);

  return (
    <section className="accessibility" aria-label={t("access.title")}>
      <h3>{t("access.title")}</h3>
      <label className="field toggle">
        <input
          type="checkbox"
          checked={large}
          onChange={(event) => {
            setLarge(event.target.checked);
            applyLargeText(event.target.checked);
          }}
        />
        {t("access.largeText")}
      </label>
    </section>
  );
}
