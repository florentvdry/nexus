import { describe, expect, it, vi } from "vitest";

import { createEngine, type EngineEvent } from "../engine/engine";
import { scriptedBridge, TEST_MODEL } from "../testing/scripted";

// Ce que le modèle local répond à chaque phrase de ces tests.
const MODEL_ANSWERS: Record<string, unknown> = {
  "Analyse example.com": { type: "OSINT_DOMAIN", domain: "example.com" },
  "analyse example.com": { type: "OSINT_DOMAIN", domain: "example.com" },
  "analyse example.org": { type: "OSINT_DOMAIN", domain: "example.org" },
  "analyse https://": { type: "UNKNOWN", text: "analyse https://" },
  "recherche le pseudo alice": { type: "OSINT_USERNAME", username: "alice" },
  'Analyse le fichier "C:\\Users\\Ana\\contrat.txt"': { type: "DOCUMENT_INSPECT", path: "C:\\Users\\Ana\\contrat.txt" },
  "analyse jean.dupont@example.com": { type: "UNKNOWN", reply: "Je ne peux pas analyser les adresses email : seuls les domaines le permettent." },
};
import { NativeUnavailableError, type NativeAdapter } from "../native/adapter";
import { unavailableNativeAdapter } from "../native";
import type { ConnectorReport, ConnectorRequest, Finding, OsintRunner } from "./types";

// Runner SIMULÉ : renvoie des rapports fixes par connecteur. Ce n'est pas une source réelle.
function simulatedRunner(reports: Partial<Record<ConnectorRequest["connector"], Partial<ConnectorReport>>>): OsintRunner & { calls: ConnectorRequest[] } {
  const calls: ConnectorRequest[] = [];
  return {
    calls,
    run: vi.fn(async (request: ConnectorRequest) => {
      calls.push(request);
      const base: ConnectorReport = { searchId: request.searchId, connector: request.connector, findings: [], errors: [], partial: false };
      return { ...base, ...reports[request.connector] };
    }),
  };
}

const finding = (overrides: Partial<Finding>): Finding => ({
  entityType: "subdomain",
  value: "www.example.com",
  source: { name: "crt.sh (transparence des certificats)", url: "https://crt.sh/?q=example.com" },
  collectedAt: 1,
  status: "verified",
  confidence: "high",
  details: [],
  note: "Présent dans un journal public.",
  ...overrides,
});

const nativeDouble: NativeAdapter = {
  systemInfo: vi.fn(),
  launchApp: vi.fn(),
  listApps: vi.fn(async () => []),
};

function setup(osint: OsintRunner, native: NativeAdapter = nativeDouble) {
  const engine = createEngine({ native, osint, bridge: scriptedBridge(MODEL_ANSWERS), model: () => TEST_MODEL, locale: "fr", responseHoldMs: 0 });
  const events: EngineEvent[] = [];
  engine.subscribe((event) => events.push(event));
  return { engine, events };
}

const presented = (events: EngineEvent[]) => events.flatMap((event) => (event.type === "present" ? [event.content] : []));
const assistant = (events: EngineEvent[]) => events.flatMap((event) => (event.type === "message" && event.role === "assistant" ? [event.text] : []));

describe("analyse d'un domaine", () => {
  it("combine DNS et certificats, garde la référence de chaque élément et lance les deux connecteurs", async () => {
    const osint = simulatedRunner({
      "domain.dns": { findings: [finding({ entityType: "ip", value: "203.0.113.10", source: { name: "Résolution DNS du système", url: null }, note: null })] },
      "domain.certificates": { findings: [finding({})] },
    });
    const { engine, events } = setup(osint);

    await engine.submit("Analyse example.com");

    expect(osint.calls.map((call) => call.connector)).toEqual(["domain.dns", "domain.certificates"]);
    expect(osint.calls.every((call) => call.target === "example.com")).toBe(true);
    const table = presented(events).find((content) => content.kind === "data-table");
    expect(table).toMatchObject({ kind: "data-table", rows: [
      ["203.0.113.10", "Vérifié", "Résolution DNS du système", "local"],
      ["www.example.com", "Vérifié", "crt.sh (transparence des certificats)", "https://crt.sh/?q=example.com"],
    ] });
    expect(assistant(events)).toEqual(["2 élément(s) trouvé(s)."]);
  });

  it("affiche les résultats partiels et la source en erreur, sans rien inventer", async () => {
    const osint = simulatedRunner({
      "domain.dns": { findings: [finding({ entityType: "ip", value: "203.0.113.10", source: { name: "Résolution DNS du système", url: null } })] },
      "domain.certificates": { partial: true, errors: ["crt.sh injoignable : timeout"] },
    });
    const { engine, events } = setup(osint);

    await engine.submit("analyse example.com");

    expect(assistant(events)).toEqual(["1 élément(s) trouvé(s). Résultats partiels : 1 erreur(s) de source."]);
    const sources = presented(events).find((content) => content.kind === "information-card" && content.title === "Sources en erreur");
    expect(sources).toMatchObject({ rows: [{ label: "Erreur", value: "crt.sh injoignable : timeout" }] });
  });

  it("présente une absence de certificat comme « introuvable », avec sa limite", async () => {
    const osint = simulatedRunner({
      "domain.certificates": {
        findings: [finding({ entityType: "domain", value: "example.org", status: "not-found", note: "Aucun certificat public listé. Cela ne prouve pas l'absence de certificat." })],
      },
    });
    const { engine, events } = setup(osint);
    await engine.submit("analyse example.org");
    const limits = presented(events).find((content) => content.kind === "information-card" && content.title === "Limites de lecture");
    expect(limits).toMatchObject({ rows: [{ value: "Aucun certificat public listé. Cela ne prouve pas l'absence de certificat." }] });
  });

  it("refuse une cible qui n'est pas un domaine avant toute requête", async () => {
    const osint = simulatedRunner({});
    const { engine, events } = setup(osint);
    await engine.submit("analyse https://");
    expect(osint.calls).toHaveLength(0);
    expect(assistant(events)).toHaveLength(1);
  });

  it("signale honnêtement l'absence du backend hors application de bureau", async () => {
    const { engine, events } = setup(
      { run: () => Promise.reject(new NativeUnavailableError()) },
      unavailableNativeAdapter,
    );
    await engine.submit("analyse example.com");
    expect(presented(events)).toContainEqual(expect.objectContaining({ kind: "error-card", code: "native-unavailable" }));
  });
});

describe("recherche de pseudo", () => {
  it("présente une correspondance comme « possible », jamais comme une identité", async () => {
    const osint = simulatedRunner({
      "username.profiles": {
        findings: [finding({ entityType: "profile", value: "https://github.com/alice", source: { name: "GitHub", url: "https://github.com/alice" }, status: "possible-match", confidence: "low", note: "Même pseudo : cela ne prouve pas que les comptes appartiennent à la même personne." })],
      },
    });
    const { engine, events } = setup(osint);
    await engine.submit("recherche le pseudo alice");
    expect(osint.calls[0]).toMatchObject({ connector: "username.profiles", target: "alice" });
    expect(presented(events).find((content) => content.kind === "data-table")).toMatchObject({ rows: [["https://github.com/alice", "Correspondance possible", "GitHub", "https://github.com/alice"]] });
  });
});

describe("analyse locale d'un fichier", () => {
  it("transmet le chemin tel quel au connecteur et affiche les détails sans contenu", async () => {
    const osint = simulatedRunner({
      "document.inspect": {
        findings: [finding({ entityType: "file", value: "contrat.txt", source: { name: "Analyse locale du fichier", url: null }, note: null, details: [{ key: "SHA-256", value: "ab12" }, { key: "Type détecté", value: "Texte (UTF-8)" }] })],
      },
    });
    const { engine, events } = setup(osint);
    await engine.submit('Analyse le fichier "C:\\Users\\Ana\\contrat.txt"');
    expect(osint.calls[0]).toMatchObject({ connector: "document.inspect", target: "C:\\Users\\Ana\\contrat.txt" });
    expect(presented(events)).toContainEqual(expect.objectContaining({ kind: "information-card", title: "Détails", rows: [{ label: "SHA-256", value: "ab12" }, { label: "Type détecté", value: "Texte (UTF-8)" }] }));
  });
});

describe("adresses email", () => {
  it("refuse l'analyse d'une adresse email et explique pourquoi", async () => {
    const osint = simulatedRunner({});
    const { engine, events } = setup(osint);
    await engine.submit("analyse jean.dupont@example.com");
    expect(osint.calls).toHaveLength(0);
    expect(assistant(events)[0]).toContain("adresses email");
  });
});
