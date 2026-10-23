import type { LanguageDictionary } from "../../../src/core/intent/dictionaries";
import type { PluginApi } from "../../../src/core/plugins/types";

/** Vocabulaire anglais : verbes, expressions et mots de remplissage. Les formes sont normalisées. */
export const DICTIONARY: LanguageDictionary = {
    openVerbs: [/\b(open|launch|start|run)\b/],
    closeAll: [/\b(close|dismiss)\b.*\b(all|every)\b|\b(all|every)\b.*\bwindows\b/],
    closeWindow: [/\b(close|dismiss)\b.*\b(window|this|that)\b/],
    cancelTasks: [/\b(cancel|abort|interrupt|stop)\b/],
    systemInfo: [
      /\b(cpu|processor|ram|memory|disk|storage|performance)\b/,
      /\b(information|info|status|resources?|usage|specs?)\b.*\b(pc|computer|machine|system)\b/,
      /\b(pc|computer|machine|system)\b.*\b(information|info|status|resources?|usage|specs?)\b/,
    ],
    help: [/\b(help|what can you do)\b/],
    fillerWords: /^(the |a |an |my )+|( please)$/g,
  };

export function activate(api: PluginApi): void {
  api.registerLanguage("en", DICTIONARY);
}
