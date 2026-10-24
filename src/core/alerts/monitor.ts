import type { SystemInfo } from "../native/adapter";

/**
 * Alertes proactives : NEXUS te prévient quand la machine se dégrade, sans que tu demandes. Une alerte est annoncée
 * une seule fois, tant qu'elle dure ; elle peut être annoncée à nouveau après une période où elle a disparu.
 */

/** Espace libre sous lequel un disque est signalé. */
export const DISK_LOW_RATIO = 0.1;
/** Charge sous laquelle une batterie débranchée est signalée. */
export const BATTERY_LOW_PERCENT = 15;
/** Part de mémoire utilisée au-delà de laquelle la mémoire est signalée. */
export const MEMORY_HIGH_RATIO = 0.9;

export interface Alert {
  key: string;
  kind: "disk" | "memory" | "battery";
  label: string;
  detail: string;
}

/** Batterie : charge et branchement. `null` pour un poste fixe ou une lecture indisponible. */
export interface Battery {
  percent: number;
  charging: boolean;
}

/** Alertes actives pour un état de la machine. Une valeur inconnue (total nul) ne déclenche rien. */
export function alertsFor(info: SystemInfo, battery: Battery | null = null): Alert[] {
  const alerts: Alert[] = [];
  if (battery && !battery.charging && battery.percent <= BATTERY_LOW_PERCENT) {
    alerts.push({ key: "battery", kind: "battery", label: "batterie", detail: `${battery.percent} % restant, branchez le chargeur` });
  }
  for (const disk of info.disks) {
    if (disk.totalBytes <= 0) continue;
    const free = disk.availableBytes / disk.totalBytes;
    if (free < DISK_LOW_RATIO) {
      alerts.push({ key: `disk:${disk.mountPoint}`, kind: "disk", label: disk.mountPoint, detail: `${Math.round(free * 100)} % libre` });
    }
  }
  if (info.memoryTotalBytes > 0 && info.memoryUsedBytes / info.memoryTotalBytes > MEMORY_HIGH_RATIO) {
    const used = Math.round((info.memoryUsedBytes / info.memoryTotalBytes) * 100);
    alerts.push({ key: "memory", kind: "memory", label: "mémoire", detail: `${used} % utilisée` });
  }
  return alerts;
}

/** Ne renvoie que les alertes nouvelles : une alerte déjà annoncée et toujours active ne se répète pas. */
export class AlertMonitor {
  #announced = new Set<string>();

  check(info: SystemInfo, battery: Battery | null = null): Alert[] {
    const active = alertsFor(info, battery);
    const activeKeys = new Set(active.map((alert) => alert.key));
    for (const key of [...this.#announced]) {
      if (!activeKeys.has(key)) this.#announced.delete(key);
    }
    const fresh = active.filter((alert) => !this.#announced.has(alert.key));
    for (const alert of fresh) this.#announced.add(alert.key);
    return fresh;
  }
}
