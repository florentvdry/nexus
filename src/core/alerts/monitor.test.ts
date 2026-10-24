import { describe, expect, it } from "vitest";

import type { SystemInfo } from "../native/adapter";
import { alertsFor, AlertMonitor } from "./monitor";

const GiB = 1024 ** 3;

function machine(overrides: Partial<SystemInfo> = {}): SystemInfo {
  return {
    osName: "Windows 11",
    hostName: "PC",
    cpuBrand: "CPU",
    cpuCount: 8,
    cpuUsagePercent: 10,
    memoryTotalBytes: 16 * GiB,
    memoryUsedBytes: 6 * GiB,
    disks: [{ mountPoint: "C:\\", totalBytes: 500 * GiB, availableBytes: 200 * GiB }],
    uptimeSeconds: 3600,
    ...overrides,
  };
}

describe("alertes proactives", () => {
  it("une machine saine ne déclenche rien", () => {
    expect(alertsFor(machine())).toEqual([]);
  });

  it("un disque presque plein est signalé, avec son espace libre", () => {
    const alerts = alertsFor(machine({ disks: [{ mountPoint: "D:\\", totalBytes: 100 * GiB, availableBytes: 5 * GiB }] }));
    expect(alerts).toEqual([{ key: "disk:D:\\", kind: "disk", label: "D:\\", detail: "5 % libre" }]);
  });

  it("une mémoire saturée est signalée", () => {
    const alerts = alertsFor(machine({ memoryUsedBytes: 15.5 * GiB }));
    expect(alerts.map((alert) => alert.kind)).toEqual(["memory"]);
  });

  it("un disque dont la taille est inconnue ne déclenche pas d'alerte", () => {
    expect(alertsFor(machine({ disks: [{ mountPoint: "E:\\", totalBytes: 0, availableBytes: 0 }] }))).toEqual([]);
  });
});

describe("une alerte n'est annoncée qu'une fois", () => {
  it("elle ne se répète pas tant qu'elle dure, mais revient après une période saine", () => {
    const monitor = new AlertMonitor();
    const full = machine({ memoryUsedBytes: 15.5 * GiB });
    expect(monitor.check(full)).toHaveLength(1);
    expect(monitor.check(full)).toHaveLength(0);
    expect(monitor.check(machine())).toHaveLength(0);
    expect(monitor.check(full)).toHaveLength(1);
  });
});

describe("batterie faible", () => {
  it("signalée sous 15 % sur batterie, pas quand le chargeur est branché", () => {
    expect(alertsFor(machine(), { percent: 12, charging: false }).map((alert) => alert.kind)).toEqual(["battery"]);
    expect(alertsFor(machine(), { percent: 12, charging: true })).toEqual([]);
    expect(alertsFor(machine(), { percent: 40, charging: false })).toEqual([]);
  });

  it("un poste sans batterie n'a pas d'alerte batterie", () => {
    expect(alertsFor(machine(), null)).toEqual([]);
  });
});
