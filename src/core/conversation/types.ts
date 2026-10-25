import type { Intent } from "../intent/types";

/** Élément auquel l'utilisateur peut se référer dans la suite : un fichier trouvé, une fenêtre listée. */
export interface Referent {
  kind: "file" | "window";
  /** Libellé lisible : nom du fichier, titre de la fenêtre. */
  label: string;
  /** Valeur utilisable par une commande : chemin absolu pour un fichier, `#identifiant` pour une fenêtre. */
  value: string;
}

/**
 * Réponse possible à une question : la commande qu'elle déclenche, réécrite et exécutée telle quelle.
 * Quand l'intention est déjà connue, elle est exécutée directement : le modèle ne relit pas le texte, qui pourrait
 * être pris pour une autre commande (« ferme la fenêtre #12 » devenant « ferme cette fenêtre »).
 */
export interface ClarificationOption {
  label: string;
  text: string;
  intent?: Intent;
}

/** Question posée à l'utilisateur, avec les réponses possibles. La prochaine saisie y répond. */
export interface Clarification {
  question: string;
  options: ClarificationOption[];
}
