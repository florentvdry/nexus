import type { PluginApi, DiscoveredPlugin, PluginManifest, PluginModule, PluginStatus } from "./types";
import { activatePlugins } from "./host";

// Découverte par dossier : chaque `plugins/<type>/<nom>/` doit contenir un `plugin.json` et un `index.ts`.
const manifestFiles = import.meta.glob<PluginManifest>("../../../plugins/*/*/plugin.json", { eager: true, import: "default" });
const moduleFiles = import.meta.glob<PluginModule>("../../../plugins/*/*/index.ts", { eager: true });

function folderOf(path: string): string {
  const match = path.match(/plugins\/([^/]+\/[^/]+)\/plugin\.json$/);
  if (!match) throw new Error(`chemin de manifeste inattendu : ${path}`);
  return match[1];
}

export function discoverBuiltinPlugins(): DiscoveredPlugin[] {
  return Object.entries(manifestFiles)
    .map(([path, manifest]) => {
      const modulePath = path.replace(/plugin\.json$/, "index.ts");
      const module: PluginModule = moduleFiles[modulePath] ?? {
        activate() {
          throw new Error("index.ts absent");
        },
      };
      return { folder: folderOf(path), manifest, module };
    })
    .sort((a, b) => a.folder.localeCompare(b.folder));
}

/** Charge tous les plugins livrés avec NEXUS. Renvoie le statut de chacun, pour l'affichage et les tests. */
export function loadBuiltinPlugins(api: PluginApi): PluginStatus[] {
  return activatePlugins(discoverBuiltinPlugins(), api);
}
