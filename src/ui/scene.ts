import type { WindowContext } from "../core/presentation/windows";
import type { Rect } from "../core/presentation/types";

function toRect(element: Element): Rect {
  const box = element.getBoundingClientRect();
  return { x: box.left, y: box.top, width: box.width, height: box.height };
}

/**
 * Lit la disposition réelle de l'écran : orbe (`[data-orb]`) et zones HUD (`[data-hud]`).
 * Le moteur de placement reste pur ; seul ce module touche au DOM.
 */
export function readWindowContext(now: number = Date.now()): WindowContext {
  const viewport = { width: window.innerWidth, height: window.innerHeight };
  const orbElement = document.querySelector("[data-orb]");
  const orbBox = orbElement ? toRect(orbElement) : { x: viewport.width / 2, y: viewport.height / 2, width: 0, height: 0 };

  return {
    now,
    scene: {
      viewport,
      orb: {
        cx: orbBox.x + orbBox.width / 2,
        cy: orbBox.y + orbBox.height / 2,
        radius: Math.min(orbBox.width, orbBox.height) / 2,
      },
      obstacles: [...document.querySelectorAll("[data-hud]")].map(toRect),
    },
  };
}
