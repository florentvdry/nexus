import { CapabilityError, toCapabilityError } from "./errors";
import { PERMISSION_TIERS, type CapabilityContext, type CapabilityHandler, type CapabilityInput, type CapabilityManifest, type CapabilityResult, type Permission } from "./types";

interface RegisteredCapability {
  manifest: CapabilityManifest;
  handler: CapabilityHandler;
  enabled: boolean;
}

export interface CapabilitySummary {
  manifest: CapabilityManifest;
  enabled: boolean;
}

function assertValidManifest(manifest: CapabilityManifest): void {
  if (!/^[a-z][a-z0-9-]*(\.[a-z][a-z0-9-]*)+$/.test(manifest.id)) {
    throw new Error(`Identifiant de capacité invalide : ${manifest.id}`);
  }
  if (!/^\d+\.\d+\.\d+$/.test(manifest.version)) {
    throw new Error(`Version invalide pour ${manifest.id} : ${manifest.version}`);
  }
  if (!Number.isFinite(manifest.timeoutMs) || manifest.timeoutMs <= 0) {
    throw new Error(`Délai d'exécution invalide pour ${manifest.id}`);
  }
}

/**
 * Registre central des capacités. Il vérifie les permissions, applique les délais, transmet
 * l'annulation et convertit toute erreur en résultat contrôlé.
 */
export class CapabilityRegistry {
  readonly #entries = new Map<string, RegisteredCapability>();
  readonly #granted: ReadonlySet<Permission>;

  constructor(grantedPermissions: Iterable<Permission>) {
    this.#granted = new Set(grantedPermissions);
  }

  register(manifest: CapabilityManifest, handler: CapabilityHandler): void {
    assertValidManifest(manifest);
    if (this.#entries.has(manifest.id)) {
      throw new Error(`Capacité déjà enregistrée : ${manifest.id}`);
    }
    this.#entries.set(manifest.id, { manifest, handler, enabled: true });
  }

  setEnabled(id: string, enabled: boolean): void {
    const entry = this.#entries.get(id);
    if (entry) entry.enabled = enabled;
  }

  list(): CapabilitySummary[] {
    return [...this.#entries.values()].map(({ manifest, enabled }) => ({ manifest, enabled }));
  }

  async invoke(id: string, input: CapabilityInput, context: CapabilityContext): Promise<CapabilityResult> {
    const entry = this.#entries.get(id);
    if (!entry) throw new CapabilityError("unknown-capability", { id });
    if (!entry.enabled) throw new CapabilityError("disabled");

    for (const permission of entry.manifest.permissions) {
      if (!this.#granted.has(permission)) throw new CapabilityError("permission-denied", { permission });
      // Une permission « confirmation » est autorisée ici ; c'est le natif qui demande l'accord de l'utilisateur.
      if (PERMISSION_TIERS[permission] === "restricted") {
        throw new CapabilityError("permission-refused", { permission });
      }
    }

    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    let onCancel = (): void => {};

    const failure = new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        reject(new CapabilityError("timeout", { seconds: String(entry.manifest.timeoutMs / 1000) }));
        controller.abort();
      }, entry.manifest.timeoutMs);

      onCancel = () => {
        reject(new CapabilityError("cancelled"));
        controller.abort();
      };
      if (context.signal.aborted) onCancel();
      else context.signal.addEventListener("abort", onCancel, { once: true });
    });

    try {
      const result = await Promise.race([
        entry.handler(input, { ...context, signal: controller.signal }),
        failure,
      ]);
      if (typeof result?.caption !== "string") throw new CapabilityError("plugin-failure");
      return result;
    } catch (error) {
      throw toCapabilityError(error);
    } finally {
      clearTimeout(timer);
      context.signal.removeEventListener("abort", onCancel);
    }
  }
}
