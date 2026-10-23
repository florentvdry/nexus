import type { PresentedContent, Size } from "./types";

export const MAX_WINDOW_HEIGHT = 420;

/** Taille souhaitée d'une fenêtre, calculée depuis le contenu. Le contenu défile au-delà de la limite. */
export function estimateSize(content: PresentedContent): Size {
  switch (content.kind) {
    case "information-card":
      return { width: 340, height: Math.min(MAX_WINDOW_HEIGHT, 72 + content.rows.length * 30) };
    case "data-table":
      return { width: 420, height: Math.min(MAX_WINDOW_HEIGHT, 72 + (content.rows.length + 1) * 30) };
    case "error-card":
      return { width: 340, height: 130 };
  }
}
