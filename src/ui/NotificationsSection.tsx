import { useState } from "react";

import type { MessageKey } from "../i18n/messages";
import { readNotifications, writeNotifications } from "./notifications";

interface NotificationsSectionProps {
  t: (key: MessageKey, params?: Record<string, string | number>) => string;
}

/** Réglage des notifications Windows pour les alertes. */
export function NotificationsSection({ t }: NotificationsSectionProps) {
  const [on, setOn] = useState(readNotifications);
  return (
    <section className="accessibility" aria-label={t("notify.title")}>
      <h3>{t("notify.title")}</h3>
      <label className="field toggle">
        <input
          type="checkbox"
          checked={on}
          onChange={(event) => {
            setOn(event.target.checked);
            writeNotifications(event.target.checked);
          }}
        />
        {t("notify.toggle")}
      </label>
      <p className="field-hint">{t("notify.hint")}</p>
    </section>
  );
}
