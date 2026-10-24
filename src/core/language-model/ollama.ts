/** Modèle installé dans Ollama, tel que le natif le renvoie. */
export interface InstalledModel {
  name: string;
  sizeBytes: number;
  parameterSize: string | null;
}

/** Une étape de téléchargement d'un modèle, émise par Ollama pendant `ollama pull`. */
export interface PullProgress {
  model: string;
  status: string;
  completed: number | null;
  total: number | null;
}

/** État d'Ollama sur ce poste : joignable ou non, et les modèles installés. */
export interface OllamaStatus {
  reachable: boolean;
  models: InstalledModel[];
}
