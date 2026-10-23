import type { Locale } from "./messages";

const BYTES_PER_GIB = 1024 ** 3;

export function formatPercent(locale: Locale, value: number): string {
  return new Intl.NumberFormat(locale, { maximumFractionDigits: 0 }).format(value);
}

export function formatGiB(locale: Locale, bytes: number): string {
  const unit = locale === "en" ? "GB" : "Go";
  return `${new Intl.NumberFormat(locale, { maximumFractionDigits: 1 }).format(bytes / BYTES_PER_GIB)} ${unit}`;
}

export function formatUptime(locale: Locale, seconds: number): string {
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const parts = locale === "en"
    ? [days && `${days}d`, `${hours}h`, `${minutes}min`]
    : [days && `${days} j`, `${hours} h`, `${minutes} min`];
  return parts.filter(Boolean).join(" ");
}

/** Taille lisible d'un fichier : octets, Ko, Mo ou Go. */
export function formatBytes(locale: Locale, bytes: number): string {
  const units = ["o", "Ko", "Mo", "Go"];
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  const formatted = new Intl.NumberFormat(locale, { maximumFractionDigits: unit === 0 ? 0 : 1 }).format(value);
  return locale === "en" ? `${formatted} ${units[unit].replace("o", "B").replace("Ko", "KB").replace("Mo", "MB").replace("Go", "GB")}` : `${formatted} ${units[unit]}`;
}

