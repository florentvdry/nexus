/** Variable d'environnement d'un connecteur MCP (jeton, identifiant de compte…). Sa valeur n'est jamais affichée. */
export interface ConnectorVariable {
  name: string;
  required: boolean;
  secret: boolean;
  description: string;
}

/** Connecteur proposé par le catalogue de confiance, avec la popularité de son dépôt. */
export interface ConnectorCandidate {
  id: string;
  title: string;
  description: string;
  repository: string;
  stars: number;
  package: string;
  version: string;
  env: ConnectorVariable[];
}

/** Classe d'outils d'un connecteur : lecture (accordée par défaut), écriture, suppression. */
export type ConnectorScope = "read" | "write" | "delete";

/** Connecteur installé, tel que l'interface le voit : les variables, si elles sont renseignées, et les accès accordés. */
export interface InstalledConnector {
  id: string;
  title: string;
  package: string;
  version: string;
  variables: (ConnectorVariable & { isSet: boolean })[];
  scopes: ConnectorScope[];
}

/** Outil exposé par un connecteur : son nom, sa description et le schéma de ses arguments. */
export interface McpTool {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}
