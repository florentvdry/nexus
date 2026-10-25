import type { PluginApi } from "../../../src/core/plugins/types";
import type { CapabilityHandler, CapabilityManifest, CapabilityResult } from "../../../src/core/capabilities/types";
import { extensionOf, fileNameOf, isAbsolutePath, viewerKindOf } from "../../../src/core/viewers/formats";

export const FILE_VIEW_MANIFEST: CapabilityManifest = {
  id: "files.view",
  name: "Visionneuse de fichiers",
  version: "1.0.0",
  description: "Affiche un fichier des dossiers utilisateur dans une fenêtre : PDF, images, texte, Markdown, CSV, audio et vidéo. Lecture seule.",
  categories: ["files"],
  inputs: ["path"],
  outputs: ["file"],
  dependencies: [],
  permissions: ["file.read"],
  locality: "local",
  requiredApis: [],
  timeoutMs: 10_000,
  cost: "local",
  offline: true,
};

/**
 * Ouvre une fenêtre de visionneuse pour un fichier désigné par son chemin complet. Rien n'est lu ici : la fenêtre
 * demande le contenu au natif, qui vérifie l'emplacement et la taille. Un format non pris en charge est refusé tout de suite.
 */
export const fileView: CapabilityHandler = async (input, context): Promise<CapabilityResult> => {
  const path = (input.path ?? "").trim();
  const { t } = context;
  const source = { capabilityId: FILE_VIEW_MANIFEST.id, locality: "local" as const, collectedAt: Date.now() };

  if (!isAbsolutePath(path)) {
    const message = t("view.needsPath");
    return { caption: message, presentations: [{ kind: "error-card", title: t("view.title"), code: "view", message }], source };
  }

  const name = fileNameOf(path);
  if (viewerKindOf(path) === null) {
    const message = t("view.unsupported", { extension: extensionOf(path) || "?" });
    return { caption: message, presentations: [{ kind: "error-card", title: name, code: "view", message }], source };
  }

  return {
    caption: t("view.caption", { name }),
    presentations: [{ kind: "file-view", title: name, path }],
    source,
  };
};

export function activate(api: PluginApi): void {
  api.registerCapability(FILE_VIEW_MANIFEST, fileView);
}
