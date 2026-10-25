import type { PresentedContent, Size } from "./types";

export const MAX_WINDOW_HEIGHT = 420;
/** Hauteur maximale d'un tableau présenté : au-delà, il défile. */
export const TABLE_MAX_HEIGHT = 300;
/**
 * Fenêtre de visionneuse. Le placement ne réduit jusqu'à 70 % : sur un écran 1280 × 800, la colonne libre à droite
 * de l'orbe ne fait que 290 px, et seule une fenêtre de 380 px réduite (266 px) y trouve une place sur la grille.
 */
export const VIEWER_WIDTH = 380;
export const VIEWER_HEIGHT = 380;

/** Hauteur d'une ligne : une ligne de plus par tranche de 40 caractères, pour les valeurs longues. */
function rowHeight(value: string): number {
  return 30 + Math.floor(value.length / 40) * 18;
}

/** Taille souhaitée d'une fenêtre, calculée depuis le contenu. Le contenu défile au-delà de la limite. */
export function estimateSize(content: PresentedContent): Size {
  switch (content.kind) {
    case "information-card": {
      const height = content.rows.reduce((total, row) => total + rowHeight(row.value), 72);
      return { width: 340, height: Math.min(MAX_WINDOW_HEIGHT, height) };
    }
    case "data-table":
      // Un tableau défile : une fenêtre trop haute ne trouve plus sa place sur l'écran de la scène.
      return { width: 380, height: Math.min(TABLE_MAX_HEIGHT, 72 + (content.rows.length + 1) * 30) };
    case "error-card":
      return { width: 340, height: 130 };
    case "draft":
      return { width: 400, height: Math.min(MAX_WINDOW_HEIGHT, 150 + Math.ceil(content.text.length / 50) * 22) };
    case "news-list":
      return { width: 420, height: Math.min(MAX_WINDOW_HEIGHT, 96 + content.items.length * 56) };
    case "image-card":
      return { width: 420, height: 380 };
    case "article-card":
      return { width: 400, height: Math.min(MAX_WINDOW_HEIGHT, 120 + Math.ceil(content.extract.length / 60) * 22) };
    case "file-view":
      // Une page de PDF, une image ou un tableau ont besoin de place : la fenêtre est plus large que les cartes.
      return { width: VIEWER_WIDTH, height: VIEWER_HEIGHT };
    case "confirmation": {
      // Au moins de quoi afficher les deux boutons, même pour une demande courte : jamais de bouton hors de la fenêtre.
      const checkbox = content.remember ? 32 : 0;
      const height = content.rows.reduce((total, row) => total + rowHeight(row.value), 72 + 56 + checkbox);
      return { width: 380, height: Math.min(MAX_WINDOW_HEIGHT, Math.max(220, height)) };
    }
  }
}
