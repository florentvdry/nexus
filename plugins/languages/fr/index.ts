import type { LanguageDictionary } from "../../../src/core/intent/dictionaries";
import type { PluginApi } from "../../../src/core/plugins/types";

/** Vocabulaire français : verbes, expressions et mots de remplissage. Les formes sont normalisées. */
export const DICTIONARY: LanguageDictionary = {
    openVerbs: [/\b(lance|lancer|lances|ouvre|ouvrir|ouvres|demarre|demarrer|start)\b/],
    closeAll: [/\b(ferme|fermer)\b.*\b(toutes|tous)\b|\b(toutes|tous)\b.*\b(fenetres|fermer)\b/],
    closeWindow: [/\b(ferme|fermer)\b.*\b(fenetre|cette fenetre|la fenetre|ca)\b/],
    cancelTasks: [/\b(annule|annuler|arrete|arreter|interromps|interrompre)\b/],
    systemInfo: [
      /\b(cpu|processeur|ram|memoire|disque|stockage|performances?)\b/,
      /\b(informations?|infos?|etat|statut|ressources?|utilisation)\b.*\b(pc|ordinateur|machine|systeme)\b/,
      /\b(pc|ordinateur|machine|systeme)\b.*\b(informations?|infos?|etat|statut|ressources?|utilisation)\b/,
    ],
    help: [/\b(aide|help|que peux tu faire)\b/],
    fillerWords: /^(le |la |les |l |un |une |mon |ma |mes |du |de la )+|( s il te plait| stp)$/g,
  };

export function activate(api: PluginApi): void {
  api.registerLanguage("fr", DICTIONARY);
}
