import { useEffect, useState } from "react";

import type { AutoApproval, NativeBridge, PermissionRule } from "../core/native/bridge";
import { RULE_ACTION } from "../core/native/rules";
import type { Locale, MessageKey } from "../i18n/messages";

/** Nombre d'actions automatiques affichées dans les réglages. */
const SHOWN = 20;

interface PermissionsSectionProps {
  bridge: NativeBridge;
  locale: Locale;
  t: (key: MessageKey, params?: Record<string, string | number>) => string;
}

/** Autorisations « toujours autoriser » : listées, révocables, avec le journal des actions approuvées automatiquement. */
export function PermissionsSection({ bridge, locale, t }: PermissionsSectionProps) {
  const [rules, setRules] = useState<PermissionRule[]>([]);
  const [audit, setAudit] = useState<AutoApproval[]>([]);
  const [unavailable, setUnavailable] = useState(false);

  useEffect(() => {
    let current = true;
    const load = async () => {
      const [nextRules, nextAudit] = await Promise.all([bridge.listRules(), bridge.listAudit()]);
      if (!current) return;
      setRules(nextRules);
      setAudit(nextAudit.slice(0, SHOWN));
    };
    load().catch(() => {
      if (current) setUnavailable(true);
    });
    // Une action approuvée par une règle apparaît tout de suite dans le journal.
    const stop = bridge.onAutoApproval(() => {
      load().catch(() => {});
    });
    return () => {
      current = false;
      stop();
    };
  }, [bridge]);

  const revoke = async (id: string) => {
    try {
      await bridge.revokeRule(id);
      setRules(await bridge.listRules());
    } catch {
      setUnavailable(true);
    }
  };

  const describe = (permission: string, scope: string) => `${RULE_ACTION[permission] ? t(RULE_ACTION[permission]) : permission} : ${scope}`;

  return (
    <section className="journal permissions" aria-label={t("rules.title")}>
      <h3>{t("rules.title")}</h3>
      {unavailable ? (
        <p className="field-hint">{t("rules.unavailable")}</p>
      ) : (
        <>
          <p className="field-hint">{t("rules.hint")}</p>
          {rules.length === 0 && <p className="field-hint">{t("rules.empty")}</p>}
          {rules.length > 0 && (
            <ul className="journal-entries">
              {rules.map((rule) => (
                <li key={rule.id}>
                  <span>{describe(rule.permission, rule.scope)}</span>
                  <button type="button" className="chip" onClick={() => void revoke(rule.id)}>
                    {t("rules.revoke")}
                  </button>
                </li>
              ))}
            </ul>
          )}
          <h4>{t("rules.audit.title")}</h4>
          {audit.length === 0 && <p className="field-hint">{t("rules.audit.empty")}</p>}
          {audit.length > 0 && (
            <ul className="journal-entries">
              {audit.map((entry, index) => (
                <li key={`${entry.at}-${index}`}>
                  <time dateTime={new Date(entry.at * 1000).toISOString()}>{new Date(entry.at * 1000).toLocaleString(locale)}</time>
                  <span>{describe(entry.permission, entry.scope)}</span>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </section>
  );
}
