import type { Intent } from "../intent/types";
import { parseTime, type Recurrence } from "../schedule/recurrence";

/**
 * Sortie du modèle, re-validée avant tout usage (TODO §1, « Branchement »). Seule la forme est contrôlée ici :
 * les racines autorisées, les confirmations et les permissions restent appliquées par le moteur et le natif.
 * Le modèle ne peut jamais produire `UNKNOWN` ni `UNSUPPORTED` : ces intentions viennent des règles.
 */

const MAX_TEXT = 500;
const DOMAIN = /^[a-z0-9-]+(\.[a-z0-9-]+)+$/i;
const USERNAME = /^[A-Za-z0-9_.-]{1,64}$/;
const NO_PARAMETER = new Set<Intent["type"]>([
  "SYSTEM_INFO",
  "CLOSE_WINDOW",
  "CLOSE_ALL_WINDOWS",
  "CANCEL_TASKS",
  "HELP",
  "PROCESS_LIST",
  "WINDOW_LIST",
  "PLUGIN_CATALOG",
  "PLUGIN_LIST",
  "MEMORY_LIST",
  "LIST_SCHEDULES",
]);

/** Texte non vide, sans espaces autour, borné. Tout autre valeur est refusée. */
function text(value: unknown, max = MAX_TEXT): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 && trimmed.length <= max ? trimmed : null;
}

/** Nom de fichier seul : pas de séparateur, pour qu'un renommage ne puisse pas sortir de son dossier. */
function fileName(value: unknown): string | null {
  const name = text(value, 255);
  return name !== null && !/[\\/]/.test(name) ? name : null;
}

function optionalText(value: unknown, max = MAX_TEXT): string | undefined | null {
  if (value === undefined) return undefined;
  return text(value, max);
}

function days(value: unknown): number | undefined | null {
  if (value === undefined) return undefined;
  return typeof value === "number" && Number.isInteger(value) && value > 0 && value <= 3650 ? value : null;
}

/** Renvoie l'intention validée, ou `null` si la forme n'est pas celle attendue. */
export function validateModelIntent(raw: unknown): Intent | null {
  if (typeof raw !== "object" || raw === null) return null;
  const candidate = raw as Record<string, unknown>;
  const type = candidate.type;
  if (typeof type !== "string") return null;

  if (NO_PARAMETER.has(type as Intent["type"])) {
    return { type } as Intent;
  }

  switch (type) {
    case "OPEN_APPLICATION": {
      const appName = text(candidate.appName, 100);
      return appName ? { type, appName } : null;
    }
    case "OSINT_DOMAIN": {
      const domain = text(candidate.domain, 253);
      return domain && DOMAIN.test(domain) ? { type, domain } : null;
    }
    case "OSINT_USERNAME": {
      const username = text(candidate.username, 64);
      return username && USERNAME.test(username) ? { type, username } : null;
    }
    case "DOCUMENT_INSPECT": {
      const path = text(candidate.path, 1000);
      return path ? { type, path } : null;
    }
    case "FILE_SEARCH": {
      const extension = optionalText(candidate.extension, 20);
      const folderHint = optionalText(candidate.folderHint, 40);
      const withinDays = days(candidate.withinDays);
      if (extension === null || folderHint === null || withinDays === null) return null;
      return {
        type,
        ...(extension !== undefined ? { extension } : {}),
        ...(folderHint !== undefined ? { folderHint } : {}),
        ...(withinDays !== undefined ? { withinDays } : {}),
      };
    }
    case "FILE_RENAME": {
      const path = text(candidate.path, 1000);
      const newName = fileName(candidate.newName);
      return path && newName ? { type, path, newName } : null;
    }
    case "FILE_MOVE": {
      const path = text(candidate.path, 1000);
      const toDir = text(candidate.toDir, 1000);
      return path && toDir ? { type, path, toDir } : null;
    }
    case "FILE_TRASH": {
      const path = text(candidate.path, 1000);
      return path ? { type, path } : null;
    }
    case "WINDOW_FOCUS":
    case "WINDOW_CLOSE": {
      const name = text(candidate.name, 100);
      return name ? { type, name } : null;
    }
    case "PLUGIN_INSTALL": {
      const target = text(candidate.target, 1000);
      return target ? { type, target } : null;
    }
    case "PLUGIN_REMOVE": {
      const id = text(candidate.id, 200);
      return id ? { type, id } : null;
    }
    case "PLUGIN_ACTION": {
      const pluginId = text(candidate.pluginId, 200);
      const command = text(candidate.command, 100);
      const body = text(candidate.text);
      return pluginId && command && body ? { type, pluginId, command, text: body } : null;
    }
    case "AGENT_RUN": {
      const project = optionalText(candidate.project, 1000);
      const prompt = optionalText(candidate.prompt);
      if (project === null || prompt === null) return null;
      return {
        type,
        ...(project !== undefined ? { project } : {}),
        ...(prompt !== undefined ? { prompt } : {}),
      };
    }
    case "REMEMBER": {
      // Une information sur l'utilisateur : une phrase, bornée. Aucune limite de nombre côté souvenirs.
      const remembered = text(candidate.text, 1000);
      return remembered ? { type, text: remembered } : null;
    }
    case "FORGET": {
      // Sans texte (ou « tout »), c'est toute la mémoire : l'interface demandera confirmation.
      const query = optionalText(candidate.query, 200);
      if (query === null) return null;
      return { type, query: query === undefined || /^tout\b/i.test(query) ? null : query };
    }
    case "SCHEDULE": {
      const request = text(candidate.request, 500);
      const recurrence = recurrenceFrom(candidate);
      return request && recurrence ? { type, request, recurrence } : null;
    }
    case "CANCEL_SCHEDULE": {
      const query = text(candidate.query, 200);
      return query ? { type, query } : null;
    }
    case "NEEDS_CONNECTOR": {
      // Le modèle nomme le service et reformule la demande ; un connecteur MCP installé la prendra en charge.
      const service = optionalText(candidate.service, 100);
      const task = text(candidate.task);
      if (service === null || task === null) return null;
      return { type, task, ...(service !== undefined ? { service } : {}) };
    }
    default:
      return null;
  }
}

/**
 * Récurrence proposée par le modèle : `kind` est « once » (avec `at`, date et heure locales), « daily » ou « weekly »
 * (avec `time` au format HH:MM, et `weekday` de 0 dimanche à 6 samedi). Toute autre forme est refusée.
 */
function recurrenceFrom(candidate: Record<string, unknown>): Recurrence | null {
  if (candidate.kind === "once") {
    const at = typeof candidate.at === "string" ? Date.parse(candidate.at) : Number.NaN;
    return Number.isFinite(at) ? { kind: "once", at } : null;
  }
  const time = text(candidate.time, 5);
  if (!time || !parseTime(time)) return null;
  if (candidate.kind === "daily") return { kind: "daily", time };
  const weekday = candidate.weekday;
  if (candidate.kind === "weekly" && typeof weekday === "number" && Number.isInteger(weekday) && weekday >= 0 && weekday <= 6) {
    return { kind: "weekly", weekday, time };
  }
  return null;
}
