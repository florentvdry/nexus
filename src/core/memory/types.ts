/** Souvenir de l'utilisateur, tel que l'interface le voit. */
export interface Memory {
  id: number;
  text: string;
  /** Instant de l'enregistrement, en millisecondes depuis l'époque Unix. */
  createdAt: number;
  /** `user` : demandé explicitement. `model` : proposé par le modèle, puis accepté. */
  source: "user" | "model";
}
