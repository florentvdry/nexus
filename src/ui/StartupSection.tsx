import { useEffect, useState } from "react";

import type { NativeBridge } from "../core/native/bridge";
import type { MessageKey } from "../i18n/messages";

interface StartupSectionProps {
  bridge: NativeBridge;
  t: (key: MessageKey, params?: Record<string, string | number>) => string;
}

/** Démarrage avec Windows : une case, lue au montage et réglée sur demande. Aucune écriture sans ce geste. */
export function StartupSection({ bridge, t }: StartupSectionProps) {
  const [enabled, setEnabled] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let current = true;
    bridge
      .startupStatus()
      .then((on) => {
        if (current) setEnabled(on);
      })
      .catch(() => {
        if (current) setError(t("startup.unavailable"));
      });
    return () => {
      current = false;
    };
  }, [bridge, t]);

  const toggle = async (on: boolean) => {
    try {
      await bridge.startupSet(on);
      setEnabled(on);
      setError(null);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : t("startup.unavailable"));
    }
  };

  return (
    <section className="startup" aria-label={t("startup.title")}>
      <h3>{t("startup.title")}</h3>
      <label className="field toggle">
        <input type="checkbox" checked={enabled} onChange={(event) => void toggle(event.target.checked)} />
        {t("startup.enable")}
      </label>
      {error && (
        <p className="field-hint" role="alert">
          {error}
        </p>
      )}
    </section>
  );
}
