import { useEffect, useState } from "react";

import type { ConnectorScope, InstalledConnector } from "../core/connectors/types";
import type { NativeBridge } from "../core/native/bridge";
import type { MessageKey } from "../i18n/messages";

const SCOPES: readonly ConnectorScope[] = ["read", "write", "delete"];

const SCOPE_LABEL: Record<ConnectorScope, MessageKey> = {
  read: "connectors.scope.read",
  write: "connectors.scope.write",
  delete: "connectors.scope.delete",
};

interface ConnectorScopesProps {
  bridge: NativeBridge;
  t: (key: MessageKey, params?: Record<string, string | number>) => string;
}

/**
 * Accès accordés à chaque connecteur installé. La lecture reste toujours active ; l'écriture et la suppression
 * s'accordent ou se retirent ici, mais chaque changement passe par la confirmation du courtier natif. Un refus
 * laisse les accès tels qu'ils étaient.
 */
export function ConnectorScopes({ bridge, t }: ConnectorScopesProps) {
  const [connectors, setConnectors] = useState<InstalledConnector[]>([]);
  /** Choix non encore confirmés, par connecteur. */
  const [draft, setDraft] = useState<Record<string, ConnectorScope[]>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [failed, setFailed] = useState<string | null>(null);

  useEffect(() => {
    let current = true;
    Promise.resolve()
      .then(() => bridge.mcpInstalled())
      .then((items) => {
        if (current) setConnectors(items);
      })
      .catch(() => {
        if (current) setConnectors([]);
      });
    return () => {
      current = false;
    };
  }, [bridge]);

  const toggle = (connector: InstalledConnector, scope: ConnectorScope) => {
    if (scope === "read") return;
    const current = draft[connector.id] ?? connector.scopes;
    const next = current.includes(scope) ? current.filter((item) => item !== scope) : [...current, scope];
    setDraft({ ...draft, [connector.id]: SCOPES.filter((item) => item === "read" || next.includes(item)) });
  };

  const save = async (connector: InstalledConnector) => {
    const wanted = draft[connector.id] ?? connector.scopes;
    setBusy(connector.id);
    setFailed(null);
    try {
      const updated = await bridge.mcpSetScopes(connector.id, wanted);
      setConnectors((list) => list.map((item) => (item.id === updated.id ? updated : item)));
      const rest = { ...draft };
      delete rest[connector.id];
      setDraft(rest);
    } catch {
      setFailed(connector.id);
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="connector-scopes">
      <h4>{t("connectors.scopes.title")}</h4>
      <p className="field-hint">{t("connectors.scopes.hint")}</p>
      {connectors.length === 0 && <p className="field-hint">{t("connectors.scopes.empty")}</p>}
      {connectors.map((connector) => {
        const current = draft[connector.id] ?? connector.scopes;
        const changed = draft[connector.id] !== undefined;
        const working = busy === connector.id;
        return (
          <fieldset key={connector.id} className="connector-scope">
            <legend>{connector.title}</legend>
            {SCOPES.map((scope) => (
              <label key={scope} className="chip">
                <input
                  type="checkbox"
                  checked={current.includes(scope)}
                  disabled={scope === "read" || working}
                  onChange={() => toggle(connector, scope)}
                />{" "}
                {t(SCOPE_LABEL[scope])}
              </label>
            ))}
            {changed && (
              <button type="button" className="chip" disabled={working} onClick={() => void save(connector)}>
                {t("connectors.scopes.save")}
              </button>
            )}
            {failed === connector.id && <p className="field-hint">{t("connectors.scopes.failed")}</p>}
          </fieldset>
        );
      })}
    </div>
  );
}
