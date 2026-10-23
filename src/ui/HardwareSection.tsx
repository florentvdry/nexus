import { useEffect, useState } from "react";

import type { HardwareProfile } from "../core/language-model/hardware";
import type { NativeBridge } from "../core/native/bridge";
import type { MessageKey } from "../i18n/messages";

type Translate = (key: MessageKey, params?: Record<string, string | number>) => string;

interface HardwareSectionProps {
  bridge: NativeBridge;
  t: Translate;
}

/** Matériel de la machine dans les réglages : la même lecture que le parcours de premier lancement, en lecture seule. */
export function HardwareSection({ bridge, t }: HardwareSectionProps) {
  const [profile, setProfile] = useState<HardwareProfile | null>(null);
  const [unavailable, setUnavailable] = useState(false);

  useEffect(() => {
    let current = true;
    bridge
      .hardwareProfile()
      .then((value) => {
        if (current) setProfile(value);
      })
      .catch(() => {
        if (current) setUnavailable(true);
      });
    return () => {
      current = false;
    };
  }, [bridge]);

  return (
    <section className="journal hardware" aria-label={t("hardware.title")}>
      <h3>{t("hardware.title")}</h3>
      {unavailable && <p className="field-hint">{t("setup.unavailable")}</p>}
      {!unavailable && !profile && <p className="field-hint">{t("setup.loading")}</p>}
      {profile && (
        <dl className="info-card">
          <div>
            <dt>{t("setup.profile.memory")}</dt>
            <dd>
              {profile.memoryGiB.toFixed(1)} {t("setup.unit.gib")}
            </dd>
          </div>
          <div>
            <dt>{t("setup.profile.cores")}</dt>
            <dd>{profile.cores}</dd>
          </div>
          <div>
            <dt>{t("setup.profile.avx2")}</dt>
            <dd>{profile.avx2 ? t("setup.profile.yes") : t("setup.profile.no")}</dd>
          </div>
          <div>
            <dt>{t("setup.profile.gpu")}</dt>
            <dd>
              {profile.gpu
                ? `${profile.gpu.name} · ${profile.gpu.vramGiB.toFixed(1)} ${t("setup.unit.gib")}`
                : t("setup.profile.gpuUnknown")}
            </dd>
          </div>
        </dl>
      )}
    </section>
  );
}
