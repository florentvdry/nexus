import { CapabilityError } from "../errors";
import { FINDING_STATUS_KEY, type ConnectorId, type ConnectorReport, type Finding, type OsintRunner } from "../../osint/types";
import type { CapabilityContext, CapabilityHandler, CapabilityManifest, CapabilityResult } from "../types";
import type { PresentedContent } from "../../presentation/types";

export const OSINT_DOMAIN_MANIFEST: CapabilityManifest = {
  id: "osint.domain",
  name: "Analyse d'un domaine",
  version: "1.0.0",
  description: "Adresses du domaine (DNS système) et noms listés dans les journaux publics de certificats. Passif.",
  categories: ["osint", "domains"],
  inputs: ["domain"],
  outputs: ["findings"],
  dependencies: [],
  permissions: ["osint.passive"],
  locality: "network",
  requiredApis: [],
  timeoutMs: 120_000,
  cost: "internet",
  offline: false,
};

export const OSINT_USERNAME_MANIFEST: CapabilityManifest = {
  ...OSINT_DOMAIN_MANIFEST,
  id: "osint.username",
  name: "Recherche de pseudo",
  description: "Présence d'un pseudo sur quelques plateformes publiques. Une correspondance n'est jamais une identité.",
  categories: ["osint", "usernames"],
  inputs: ["username"],
  timeoutMs: 120_000,
};

export const DOCUMENT_INSPECT_MANIFEST: CapabilityManifest = {
  ...OSINT_DOMAIN_MANIFEST,
  id: "document.inspect",
  name: "Analyse locale d'un fichier",
  description: "Empreinte SHA-256, taille, type et statistiques d'un fichier désigné. Rien n'est envoyé.",
  categories: ["documents"],
  inputs: ["path"],
  permissions: ["file.read"],
  locality: "local",
  timeoutMs: 30_000,
  cost: "local",
  offline: true,
};

async function collect(context: CapabilityContext, runner: OsintRunner, connector: ConnectorId, target: string): Promise<ConnectorReport> {
  if (context.signal.aborted) throw new CapabilityError("cancelled");
  return runner.run({ connector, target, searchId: crypto.randomUUID() });
}

function summarize(reports: ConnectorReport[], target: string, context: CapabilityContext, capabilityId: string): CapabilityResult {
  const { t, locale } = context;
  const findings: Finding[] = reports.flatMap((report) => report.findings);
  const errors = reports.flatMap((report) => report.errors);
  const partial = reports.some((report) => report.partial);

  const presentations: PresentedContent[] = [];
  if (findings.length > 0) {
    presentations.push({
      kind: "data-table",
      title: t("osint.resultsTitle", { target }),
      columns: [t("osint.col.entity"), t("osint.col.status"), t("osint.col.source"), t("osint.col.reference")],
      rows: findings.map((finding) => [finding.value, t(FINDING_STATUS_KEY[finding.status]), finding.source.name, finding.source.url ?? "local"]),
    });
  } else {
    presentations.push({ kind: "information-card", title: t("osint.resultsTitle", { target }), rows: [{ label: t("osint.col.status"), value: t("osint.noResult") }] });
  }

  const documentFinding = findings.find((finding) => finding.entityType === "file");
  if (documentFinding) {
    presentations.push({
      kind: "information-card",
      title: t("osint.details"),
      rows: documentFinding.details.map((detail) => ({ label: detail.key, value: detail.value })),
    });
  }

  const notes = [...new Set(findings.map((finding) => finding.note).filter((note): note is string => Boolean(note)))];
  if (notes.length > 0) {
    presentations.push({ kind: "information-card", title: t("osint.notesTitle"), rows: notes.map((note, index) => ({ label: String(index + 1), value: note })) });
  }

  if (errors.length > 0) {
    presentations.push({ kind: "information-card", title: t("osint.sourcesTitle"), rows: errors.map((error) => ({ label: t("osint.sourceError"), value: error })) });
  }

  const caption = partial
    ? t("osint.caption.partial", { count: findings.length, errors: errors.length })
    : t("osint.caption.complete", { count: findings.length });

  void locale;
  return { caption, presentations, source: { capabilityId, locality: capabilityId === "document.inspect" ? "local" : "network", collectedAt: Date.now() } };
}

function required(input: Record<string, string>, key: string): string {
  const value = input[key];
  if (!value) throw new CapabilityError("invalid-target", { details: key });
  return value;
}

export const osintDomain: CapabilityHandler = async (input, context) => {
  const domain = required(input, "domain");
  const runner = context.osint;
  const reports = [
    await collect(context, runner, "domain.dns", domain),
    await collect(context, runner, "domain.certificates", domain),
  ];
  return summarize(reports, domain, context, OSINT_DOMAIN_MANIFEST.id);
};

export const osintUsername: CapabilityHandler = async (input, context) => {
  const username = required(input, "username");
  const report = await collect(context, context.osint, "username.profiles", username);
  return summarize([report], username, context, OSINT_USERNAME_MANIFEST.id);
};

export const documentInspect: CapabilityHandler = async (input, context) => {
  const path = required(input, "path");
  const report = await collect(context, context.osint, "document.inspect", path);
  return summarize([report], path.split(/[\\/]/).pop() ?? path, context, DOCUMENT_INSPECT_MANIFEST.id);
};
