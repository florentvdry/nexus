import { CapabilityError } from "../capabilities/errors";
import type { CapabilityContext, CapabilityResult } from "../capabilities/types";
import type { PresentedContent } from "../presentation/types";
import { FINDING_STATUS_KEY, type ConnectorId, type ConnectorReport, type Finding, type OsintRunner } from "./types";

export async function collect(context: CapabilityContext, runner: OsintRunner, connector: ConnectorId, target: string): Promise<ConnectorReport> {
  if (context.signal.aborted) throw new CapabilityError("cancelled");
  return runner.run({ connector, target, searchId: crypto.randomUUID() });
}

export function summarize(reports: ConnectorReport[], target: string, context: CapabilityContext, capabilityId: string): CapabilityResult {
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

export function required(input: Record<string, string>, key: string): string {
  const value = input[key];
  if (!value) throw new CapabilityError("invalid-target", { details: key });
  return value;
}
