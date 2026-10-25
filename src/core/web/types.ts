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

/** Nature d'une source, d'après son domaine (classée par le natif : officiel et référence avant commercial). */
export type WebSourceKind = "official" | "reference" | "other" | "commercial";

/** Un résultat de recherche web : titre, adresse de la page, extrait, et nature de la source. */
export interface WebSearchHit {
  title: string;
  url: string;
  snippet: string;
  kind?: WebSourceKind;
}

/** Texte lisible d'une page web, borné, avec son adresse. */
export interface WebPage {
  url: string;
  text: string;
}

/** Photo libre d'une source publique. L'image est déjà téléchargée, en data URL. */
export interface WebPhoto {
  title: string;
  dataUrl: string;
  credit: string;
  license: string;
  page: string;
}
