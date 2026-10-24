export interface Size {
  width: number;
  height: number;
}

export interface Rect extends Size {
  x: number;
  y: number;
}

export interface Circle {
  cx: number;
  cy: number;
  radius: number;
}

export interface InformationRow {
  label: string;
  value: string;
}

/** Contenus normalisés produits par les capacités. Le moteur de présentation choisit le composant. */
export type PresentedContent =
  | { kind: "information-card"; title: string; rows: InformationRow[] }
  | { kind: "data-table"; title: string; columns: string[]; rows: string[][] }
  | { kind: "error-card"; title: string; code: string; message: string }
  /** Photo d'une source publique, avec son auteur et sa licence. L'image est déjà téléchargée (data URL). */
  | { kind: "image-card"; title: string; imageUrl: string; credit: string; license: string; page: string }
  /** Actualités d'une date (Wikipédia fr), chacune avec sa page de référence. */
  | { kind: "news-list"; title: string; items: { text: string; page: string }[]; source: string }
  /** Résumé d'un sujet (Wikipédia), avec la page d'origine. */
  | { kind: "article-card"; title: string; extract: string; page: string }
  /** Demande de confirmation : les boutons répondent au natif, qui décide de l'action. */
  | {
      kind: "confirmation";
      requestId: string;
      title: string;
      rows: InformationRow[];
      approve: string;
      refuse: string;
      /** Case « toujours autoriser », présente seulement si l'action peut être mémorisée. */
      remember?: { label: string };
    };
