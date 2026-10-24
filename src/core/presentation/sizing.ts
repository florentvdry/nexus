import type { PresentedContent, Size } from "./types";

export const MAX_WINDOW_HEIGHT = 420;

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
      return { width: 420, height: Math.min(MAX_WINDOW_HEIGHT, 72 + (content.rows.length + 1) * 30) };
    case "error-card":
      return { width: 340, height: 130 };
    case "image-card":
      return { width: 420, height: 380 };
    case "article-card":
      return { width: 400, height: Math.min(MAX_WINDOW_HEIGHT, 120 + Math.ceil(content.extract.length / 60) * 22) };
    case "confirmation": {
      // Au moins de quoi afficher les deux boutons, même pour une demande courte : jamais de bouton hors de la fenêtre.
      const checkbox = content.remember ? 32 : 0;
      const height = content.rows.reduce((total, row) => total + rowHeight(row.value), 72 + 56 + checkbox);
      return { width: 380, height: Math.min(MAX_WINDOW_HEIGHT, Math.max(220, height)) };
    }
  }
}
