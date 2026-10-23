import type { Locale } from "../../i18n/messages";

/** Connecteurs exécutés par le worker. Miroir de `connectors::CONNECTORS` côté Rust. */
export type ConnectorId = "domain.dns" | "domain.certificates" | "username.profiles" | "document.inspect";

export type FindingStatus = "verified" | "possible-match" | "unverified" | "not-found" | "source-unreachable" | "error";
export type Confidence = "high" | "medium" | "low";

export interface SourceRef {
  name: string;
  url: string | null;
}

export interface Detail {
  key: string;
  value: string;
}

/** Résultat normalisé : chaque élément garde sa source, sa référence et son statut. */
export interface Finding {
  entityType: string;
  value: string;
  source: SourceRef;
  collectedAt: number;
  status: FindingStatus;
  confidence: Confidence;
  details: Detail[];
  note: string | null;
}

export interface ConnectorReport {
  searchId: string;
  connector: ConnectorId;
  findings: Finding[];
  errors: string[];
  /** Vrai dès qu'une source n'a pas répondu ou qu'une limite a été atteinte. */
  partial: boolean;
}

export interface ConnectorRequest {
  connector: ConnectorId;
  target: string;
  searchId: string;
}

/** Exécute un connecteur isolé. Une implémentation simulée n'existe que dans les tests. */
export interface OsintRunner {
  run(request: ConnectorRequest): Promise<ConnectorReport>;
}

export const FINDING_STATUS_KEY: Record<FindingStatus, "osint.status.verified" | "osint.status.possibleMatch" | "osint.status.unverified" | "osint.status.notFound" | "osint.status.unreachable" | "osint.status.error"> = {
  verified: "osint.status.verified",
  "possible-match": "osint.status.possibleMatch",
  unverified: "osint.status.unverified",
  "not-found": "osint.status.notFound",
  "source-unreachable": "osint.status.unreachable",
  error: "osint.status.error",
};

export type { Locale };
