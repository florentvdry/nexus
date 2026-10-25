import type { OrbState } from "../core/engine/engine";

/** Les sept états du moteur regroupés en cinq teintes de l'orbe plasma. */
export type OrbTone = "rest" | "listen" | "think" | "reply" | "error";

const TONE: Record<OrbState, OrbTone> = {
  idle: "rest",
  listening: "listen",
  recognizing: "listen",
  thinking: "think",
  executing: "think",
  responding: "reply",
  error: "error",
};

/** hero : accueil, avec anneau. medium : parcours de démarrage. small : en-tête de conversation. */
export type OrbSize = "hero" | "medium" | "small";

/**
 * Orbe plasma : des nappes de couleur floues qui coulent sous une surface de verre. Tout est en CSS
 * (voir App.css, section « Orbe plasma ») ; le ton et la taille passent par des attributs data-.
 */
export function Orb({ state, size = "medium" }: { state: OrbState; size?: OrbSize }) {
  return (
    <div className="orb" data-orb data-tone={TONE[state]} data-size={size} aria-hidden="true">
      {size !== "small" && <span className="orb-halo" />}
      {size === "hero" && <span className="orb-ring" />}
      <span className="orb-core">
        <span className="orb-blob orb-blob-1" />
        <span className="orb-blob orb-blob-2" />
        <span className="orb-blob orb-blob-3" />
        <span className="orb-sheen" />
      </span>
    </div>
  );
}
