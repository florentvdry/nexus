/** Résumé d'un sujet, tel que Wikipédia le donne. La page d'origine est toujours citée. */
export interface WebSummary {
  title: string;
  extract: string;
  page: string;
}

/** Un élément de l'actualité du jour, avec sa page de référence. */
export interface WebNewsItem {
  text: string;
  page: string;
}

/** Photo libre d'une source publique. L'image est déjà téléchargée, en data URL. */
export interface WebPhoto {
  title: string;
  dataUrl: string;
  credit: string;
  license: string;
  page: string;
}
