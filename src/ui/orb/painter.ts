import type { OrbState } from "../../core/engine/engine";

/** Rayon extérieur de l'orbe, en fraction de sa demi-dimension. Sert aussi à la zone à préserver. */
export const ORB_OUTER_RADIUS = 0.92;

export interface OrbProfile {
  color: [number, number, number];
  /** Vitesse de rotation des anneaux, en radians par seconde. */
  ringSpeed: number;
  pulseAmplitude: number;
  /** Fréquence de la pulsation, en hertz. 0 pour une orbe sans pulsation. */
  pulseFrequency: number;
  /** Nombre d'arcs orbitaux. */
  arcs: number;
  /** Amplitude du tremblement, utilisée uniquement pour l'erreur. */
  jitter: number;
  /** Amplitude de l'onde sonore, utilisée uniquement pour la reconnaissance vocale. */
  wave: number;
  /** Anneaux qui s'écartent du centre, utilisé pour l'écoute. */
  expand: boolean;
}

/** Une animation distincte par état de JARVIS. Les états vocaux sont prêts avant la phase 2. */
export const ORB_PROFILES: Record<OrbState, OrbProfile> = {
  idle: { color: [139, 108, 255], ringSpeed: 0.12, pulseAmplitude: 0.02, pulseFrequency: 0.5, arcs: 2, jitter: 0, wave: 0, expand: false },
  listening: { color: [120, 150, 255], ringSpeed: 0.35, pulseAmplitude: 0.05, pulseFrequency: 1.4, arcs: 3, jitter: 0, wave: 0, expand: true },
  recognizing: { color: [110, 180, 255], ringSpeed: 0.5, pulseAmplitude: 0, pulseFrequency: 0, arcs: 3, jitter: 0, wave: 0.08, expand: false },
  thinking: { color: [165, 120, 255], ringSpeed: 1.1, pulseAmplitude: 0.03, pulseFrequency: 0.9, arcs: 4, jitter: 0, wave: 0, expand: false },
  executing: { color: [150, 130, 255], ringSpeed: 1.9, pulseAmplitude: 0.025, pulseFrequency: 1.2, arcs: 2, jitter: 0, wave: 0, expand: false },
  responding: { color: [185, 150, 255], ringSpeed: 0.3, pulseAmplitude: 0.09, pulseFrequency: 2.2, arcs: 2, jitter: 0, wave: 0, expand: false },
  error: { color: [255, 100, 125], ringSpeed: 0.2, pulseAmplitude: 0.03, pulseFrequency: 0, arcs: 1, jitter: 0.025, wave: 0, expand: false },
};

export interface DrawOptions {
  /** Multiplie la vitesse d'animation. */
  motionScale?: number;
  /** Supprime les mouvements parasites (tremblement) pour l'accessibilité. */
  reduceMotion?: boolean;
}

/** Inclinaison des trois anneaux (1 = cercle, plus petit = plus aplati) : donne l'effet d'orbites en 3D. */
const RING_TILT = [0.34, 0.5, 0.66];
/** Points de chaque anneau. */
const RING_DOTS = [40, 54, 68];
/** Longueur de la traîne d'un arc orbital, en radians. Elle s'estompe vers l'arrière. */
const ARC_LENGTH = 1.1;
const ARC_SEGMENTS = 10;

export function drawOrb(
  ctx: CanvasRenderingContext2D,
  time: number,
  state: OrbState,
  width: number,
  height: number,
  options: DrawOptions = {},
): void {
  const { motionScale = 1, reduceMotion = false } = options;
  const profile = ORB_PROFILES[state];
  const [red, green, blue] = profile.color;
  const unit = Math.min(width, height) / 2;
  const t = time * motionScale;
  const color = (alpha: number) => `rgba(${red}, ${green}, ${blue}, ${alpha})`;

  const pulse = 1 + (profile.pulseFrequency > 0 ? profile.pulseAmplitude * Math.sin(2 * Math.PI * profile.pulseFrequency * t) : 0);
  const shake = !reduceMotion && profile.jitter > 0 ? (profile.jitter * unit * (Math.sin(t * 61) + Math.sin(t * 37))) / 2 : 0;
  const cx = width / 2 + shake;
  const cy = height / 2 + shake * 0.5;

  ctx.clearRect(0, 0, width, height);

  // Halo large et doux, puis halo proche : la lueur se détache du fond sans bord visible.
  const haloRadius = unit * 1.02 * pulse;
  const halo = ctx.createRadialGradient(cx, cy, unit * 0.2, cx, cy, haloRadius);
  halo.addColorStop(0, color(0.42));
  halo.addColorStop(0.55, color(0.14));
  halo.addColorStop(0.85, color(0.04));
  halo.addColorStop(1, color(0));
  ctx.fillStyle = halo;
  ctx.beginPath();
  ctx.arc(cx, cy, haloRadius, 0, Math.PI * 2);
  ctx.fill();

  // Cœur : dégradé, reflet spéculaire et fine bordure lumineuse.
  const coreRadius = unit * 0.4 * pulse;
  const core = ctx.createRadialGradient(cx - coreRadius * 0.35, cy - coreRadius * 0.35, coreRadius * 0.1, cx, cy, coreRadius);
  core.addColorStop(0, "rgba(255, 255, 255, 0.95)");
  core.addColorStop(0.3, color(0.95));
  core.addColorStop(1, `rgba(${Math.round(red * 0.25)}, ${Math.round(green * 0.25)}, ${Math.round(blue * 0.45)}, 0.95)`);
  ctx.fillStyle = core;
  ctx.beginPath();
  ctx.arc(cx, cy, coreRadius, 0, Math.PI * 2);
  ctx.fill();

  const highlightRadius = coreRadius * 0.3;
  const highlightX = cx - coreRadius * 0.38;
  const highlightY = cy - coreRadius * 0.38;
  const highlight = ctx.createRadialGradient(highlightX, highlightY, 0, highlightX, highlightY, highlightRadius);
  highlight.addColorStop(0, "rgba(255, 255, 255, 0.9)");
  highlight.addColorStop(1, "rgba(255, 255, 255, 0)");
  ctx.fillStyle = highlight;
  ctx.beginPath();
  ctx.arc(highlightX, highlightY, highlightRadius, 0, Math.PI * 2);
  ctx.fill();

  ctx.lineWidth = 1.2;
  ctx.strokeStyle = color(0.5);
  ctx.beginPath();
  ctx.arc(cx, cy, coreRadius * 1.01, 0, Math.PI * 2);
  ctx.stroke();

  // Anneaux inclinés : la moitié arrière est atténuée, la moitié avant brille.
  RING_TILT.forEach((tilt, index) => {
    const ringRadius = [0.6, 0.72, 0.84][index];
    const expansion = profile.expand ? 1 + 0.06 * Math.sin(t * 2.2 + index) : 1;
    const dots = RING_DOTS[index];
    const direction = index % 2 === 0 ? 1 : -1;
    const rotation = t * profile.ringSpeed * direction * (1 - index * 0.2);
    for (let dot = 0; dot < dots; dot += 1) {
      const angle = rotation + (dot / dots) * Math.PI * 2;
      const major = dot % 4 === 0;
      const front = Math.sin(angle) > 0;
      const depth = front ? 1 : 0.3;
      const x = cx + Math.cos(angle) * unit * ringRadius * expansion;
      const y = cy + Math.sin(angle) * unit * ringRadius * expansion * tilt;
      ctx.fillStyle = color((major ? 0.85 : 0.35) * (1 - index * 0.2) * depth);
      ctx.beginPath();
      ctx.arc(x, y, (major ? 1.8 : 1.1) * (front ? 1.15 : 0.85), 0, Math.PI * 2);
      ctx.fill();
    }
  });

  // Arcs orbitaux en traîne : la tête est vive, la queue s'efface.
  ctx.lineWidth = 2.2;
  ctx.lineCap = "round";
  const segment = ARC_LENGTH / ARC_SEGMENTS;
  for (let index = 0; index < profile.arcs; index += 1) {
    const start = t * profile.ringSpeed * 1.6 + (index * Math.PI * 2) / profile.arcs;
    for (let step = 0; step < ARC_SEGMENTS; step += 1) {
      const from = start + step * segment;
      ctx.strokeStyle = color(((step + 1) / ARC_SEGMENTS) * 0.9);
      ctx.beginPath();
      ctx.arc(cx, cy, unit * ORB_OUTER_RADIUS, from, from + segment);
      ctx.stroke();
    }
  }

  if (profile.wave > 0) {
    const steps = 160;
    ctx.lineWidth = 1.6;
    ctx.strokeStyle = color(0.85);
    ctx.beginPath();
    for (let step = 0; step <= steps; step += 1) {
      const angle = (step / steps) * Math.PI * 2;
      const amplitude = profile.wave * (0.5 + 0.5 * Math.sin(angle * 5 + t * 6)) * (0.6 + 0.4 * Math.sin(angle * 3 - t * 4));
      const radius = unit * (0.66 + amplitude);
      const x = cx + Math.cos(angle) * radius;
      const y = cy + Math.sin(angle) * radius;
      if (step === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.closePath();
    ctx.stroke();
  }
}
