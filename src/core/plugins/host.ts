import { PERMISSION_TIERS } from "../capabilities/types";
import { API_VERSION, PLUGIN_TYPES, type DiscoveredPlugin, type PluginApi, type PluginManifest, type PluginStatus } from "./types";

/** Liste les problèmes d'un manifeste. Un manifeste sans problème renvoie un tableau vide. */
export function validateManifest(manifest: PluginManifest, folder: string): string[] {
  const [type, name] = folder.split("/");
  const problems: string[] = [];
  if (!(PLUGIN_TYPES as readonly string[]).includes(type)) problems.push(`type de dossier inconnu : ${type}`);
  if (manifest.type !== type) problems.push(`type « ${manifest.type} » déclaré dans un dossier « ${type} »`);
  if (manifest.id !== `${type}.${name}`) problems.push(`identifiant attendu « ${type}.${name} », reçu « ${manifest.id} »`);
  if (manifest.apiVersion !== API_VERSION) problems.push(`API ${manifest.apiVersion} non supportée (attendue : ${API_VERSION})`);
  if (!/^\d+\.\d+\.\d+$/.test(manifest.version)) problems.push(`version invalide : ${manifest.version}`);
  for (const permission of manifest.permissions) {
    if (!(permission in PERMISSION_TIERS)) problems.push(`permission inconnue : ${permission}`);
  }
  return problems;
}

/**
 * Active un plugin. Toute erreur reste confinée à ce plugin : les autres continuent de se charger.
 * Le plugin ne peut enregistrer que ce que son manifeste déclare.
 */
export function activatePlugin(plugin: DiscoveredPlugin, api: PluginApi): PluginStatus {
  const { id, folder, manifest } = { ...plugin, id: plugin.manifest.id };
  const problems = validateManifest(manifest, folder);
  if (problems.length > 0) return { id, folder, state: "failed", error: problems.join(" ; ") };

  const scoped: PluginApi = {
    registerCapability(capability, handler) {
      if (!manifest.capabilities.includes(capability.id)) throw new Error(`capacité non déclarée : ${capability.id}`);
      // Le plugin ne voit que le pont attribué à son identifiant : le natif applique les permissions de son manifeste.
      api.registerCapability(capability, (input, context) => handler(input, { ...context, bridge: context.bridge.forPlugin(id) }));
    },
    registerLanguage(locale, dictionary) {
      if (!manifest.languages.includes(locale)) throw new Error(`langue non déclarée : ${locale}`);
      api.registerLanguage(locale, dictionary);
    },
    registerApplications(entries) {
      if (!manifest.applications) throw new Error("catalogue d'applications non déclaré");
      api.registerApplications(entries);
    },
  };

  try {
    plugin.module.activate(scoped);
    return { id, folder, state: "active" };
  } catch (error) {
    return { id, folder, state: "failed", error: error instanceof Error ? error.message : String(error) };
  }
}

export function activatePlugins(plugins: DiscoveredPlugin[], api: PluginApi): PluginStatus[] {
  return plugins.map((plugin) => activatePlugin(plugin, api));
}
