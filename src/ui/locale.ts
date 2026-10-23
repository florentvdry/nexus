import { SUPPORTED_LOCALES, detectLocale, type Locale } from "../i18n/messages";

const STORAGE_KEY = "nexus.locale";

/** Préférence de langue locale au poste. Le stockage peut être indisponible : on retombe sur la langue du système. */
export function readStoredLocale(): Locale {
  try {
    const stored = window.localStorage.getItem(STORAGE_KEY);
    if (stored && (SUPPORTED_LOCALES as readonly string[]).includes(stored)) return stored as Locale;
  } catch {
    // Stockage bloqué (navigation privée, politique de sécurité) : valeur par défaut.
  }
  return detectLocale(navigator.language);
}

export function storeLocale(locale: Locale): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, locale);
  } catch {
    // Le choix de langue reste valable pour la session courante.
  }
}
