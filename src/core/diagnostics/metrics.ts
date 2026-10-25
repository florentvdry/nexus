/**
 * Mesures locales : durée et réussite des appels au natif, gardées en mémoire pour ce poste seulement. Rien n'est
 * envoyé ; la fenêtre de diagnostic les affiche, et elles disparaissent à la fermeture de NEXUS.
 */

/** Nombre de mesures gardées par commande : les plus récentes. */
export const MAX_SAMPLES = 200;

interface Series {
  durations: number[];
  count: number;
  failures: number;
}

const series = new Map<string, Series>();

export interface OperationStats {
  command: string;
  count: number;
  failures: number;
  p50Ms: number;
  p95Ms: number;
}

/** Rang le plus proche : la valeur au-dessous de laquelle se trouve `p` % des mesures. */
export function percentile(sorted: readonly number[], p: number): number {
  if (sorted.length === 0) return 0;
  const rank = Math.ceil((p / 100) * sorted.length);
  return sorted[Math.min(sorted.length, Math.max(1, rank)) - 1];
}

export function recordCall(command: string, durationMs: number, ok: boolean): void {
  const entry = series.get(command) ?? { durations: [], count: 0, failures: 0 };
  entry.durations.push(Math.max(0, Math.round(durationMs)));
  if (entry.durations.length > MAX_SAMPLES) entry.durations.shift();
  entry.count += 1;
  if (!ok) entry.failures += 1;
  series.set(command, entry);
}

/** Statistiques par commande, les plus utilisées d'abord. */
export function operationStats(): OperationStats[] {
  return [...series.entries()]
    .map(([command, entry]) => {
      const sorted = [...entry.durations].sort((a, b) => a - b);
      return { command, count: entry.count, failures: entry.failures, p50Ms: percentile(sorted, 50), p95Ms: percentile(sorted, 95) };
    })
    .sort((a, b) => b.count - a.count || a.command.localeCompare(b.command));
}

export function resetStats(): void {
  series.clear();
}
