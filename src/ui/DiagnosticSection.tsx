import { useEffect, useState } from "react";

import { operationStats, type OperationStats } from "../core/diagnostics/metrics";
import type { BudgetView, NativeBridge } from "../core/native/bridge";
import type { MessageKey } from "../i18n/messages";

interface DiagnosticSectionProps {
  bridge: NativeBridge;
  t: (key: MessageKey, params?: Record<string, string | number>) => string;
}

const BUDGET_LABEL: Record<string, MessageKey> = {
  classify: "budget.classify",
  vision: "budget.vision",
  web: "budget.web",
  plugins: "budget.plugins",
};

/** Bornes des délais, en secondes : les mêmes que côté natif. */
const MIN_SECS = 5;
const MAX_SECS = 600;

/**
 * Diagnostic local : durée et réussite des appels, mémoire de NEXUS, et délais réglables. Tout reste sur ce poste.
 */
export function DiagnosticSection({ bridge, t }: DiagnosticSectionProps) {
  const [stats, setStats] = useState<OperationStats[]>(operationStats);
  const [memory, setMemory] = useState<number | null>(null);
  const [budgets, setBudgets] = useState<BudgetView[]>([]);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);

  const refresh = () => {
    setStats(operationStats());
    bridge
      .resources()
      .then((resources) => setMemory(resources.processMemoryMb))
      .catch(() => setMemory(null));
  };

  useEffect(() => {
    let current = true;
    refresh();
    bridge
      .budgets()
      .then((items) => {
        if (current) setBudgets(items);
      })
      .catch(() => {
        if (current) setBudgets([]);
      });
    return () => {
      current = false;
    };
    // `refresh` ne dépend que du pont : une lecture au montage suffit.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bridge]);

  const save = async (budget: BudgetView) => {
    const seconds = Number(drafts[budget.key] ?? budget.seconds);
    if (!Number.isInteger(seconds) || seconds < MIN_SECS || seconds > MAX_SECS) {
      setError(t("diag.badDelay", { min: MIN_SECS, max: MAX_SECS }));
      return;
    }
    try {
      setBudgets(await bridge.setBudget(budget.key, seconds));
      setDrafts({});
      setError(null);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : String(failure));
    }
  };

  return (
    <section className="diagnostic" aria-label={t("diag.title")}>
      <h3>{t("diag.title")}</h3>
      <p className="field-hint">{t("diag.hint")}</p>
      <p className="field-hint">
        {t("diag.memory")} : {memory === null ? t("diag.unknown") : `${memory.toFixed(0)} Mo`}
      </p>
      <button type="button" className="chip" onClick={refresh}>
        {t("diag.refresh")}
      </button>

      {stats.length === 0 ? (
        <p className="field-hint">{t("diag.none")}</p>
      ) : (
        <table className="diagnostic-table">
          <thead>
            <tr>
              <th scope="col">{t("diag.operation")}</th>
              <th scope="col">{t("diag.calls")}</th>
              <th scope="col">{t("diag.failures")}</th>
              <th scope="col">{t("diag.p50")}</th>
              <th scope="col">{t("diag.p95")}</th>
            </tr>
          </thead>
          <tbody>
            {stats.map((item) => (
              <tr key={item.command}>
                <th scope="row">{item.command}</th>
                <td>{item.count}</td>
                <td>{item.failures}</td>
                <td>{item.p50Ms} ms</td>
                <td>{item.p95Ms} ms</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <p className="field-hint">{t("diag.confirmationNote")}</p>

      <h4>{t("diag.budgets")}</h4>
      <p className="field-hint">{t("diag.budgetsHint", { min: MIN_SECS, max: MAX_SECS })}</p>
      {budgets.map((budget) => (
        <label key={budget.key} className="field">
          <span>{t(BUDGET_LABEL[budget.key] ?? "diag.budgets")}</span>
          <input
            type="number"
            min={MIN_SECS}
            max={MAX_SECS}
            step={1}
            value={drafts[budget.key] ?? String(budget.seconds)}
            onChange={(event) => setDrafts({ ...drafts, [budget.key]: event.target.value })}
            onBlur={() => void save(budget)}
            aria-describedby={`budget-${budget.key}-hint`}
          />
          <small id={`budget-${budget.key}-hint`} className="field-hint">
            {t("diag.defaultDelay", { seconds: budget.defaultSeconds })}
          </small>
        </label>
      ))}
      {error && (
        <p className="field-hint" role="alert">
          {error}
        </p>
      )}
    </section>
  );
}
