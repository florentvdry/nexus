import { useState } from "react";

import type { MessageKey } from "../i18n/messages";
import { applyLargeText, readLargeText } from "./textScale";
import { applyTheme, readTheme, THEME_CHOICES, type ThemeChoice } from "./theme";

interface AccessibilitySectionProps {
  t: (key: MessageKey, params?: Record<string, string | number>) => string;
}

const THEME_LABEL: Record<ThemeChoice, MessageKey> = {
  system: "access.theme.system",
  dark: "access.theme.dark",
  light: "access.theme.light",
};

/** Réglages d'accessibilité : taille du texte et thème. Le mouvement réduit suit déjà le système. */
export function AccessibilitySection({ t }: AccessibilitySectionProps) {
  const [large, setLarge] = useState(readLargeText);
  const [theme, setTheme] = useState<ThemeChoice>(readTheme);

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
      <label className="field">
        {t("access.theme")}
        <select
          value={theme}
          onChange={(event) => {
            const next = event.target.value as ThemeChoice;
            setTheme(next);
            applyTheme(next);
          }}
        >
          {THEME_CHOICES.map((choice) => (
            <option key={choice} value={choice}>
              {t(THEME_LABEL[choice])}
            </option>
          ))}
        </select>
      </label>
    </section>
  );
}
