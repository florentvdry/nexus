const STORAGE_KEY = "nexus.modelSetup.seen";

/**
 * Le parcours de premier lancement a-t-il déjà été vu sur ce poste ? Le stockage peut être indisponible : dans ce cas
 * le parcours s'affiche au lancement, ce qui reste sans gravité puisqu'il se passe à tout moment.
 */
export function hasSeenModelSetup(): boolean {
  try {
    return window.localStorage.getItem(STORAGE_KEY) === "1";
  } catch {
    return false;
  }
}

/** Mémorise que le parcours a été vu (fermé, passé ou terminé). Si le stockage manque, il réapparaîtra au lancement suivant. */
export function markModelSetupSeen(): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, "1");
  } catch {
    // Stockage indisponible : le parcours réapparaîtra au prochain lancement.
  }
}

const FIRST_CONVERSATION_KEY = "nexus.firstConversation.done";

/** La première conversation (questions sur l'utilisateur) a-t-elle déjà commencé sur ce poste ? */
export function hasFirstConversation(): boolean {
  try {
    return window.localStorage.getItem(FIRST_CONVERSATION_KEY) === "1";
  } catch {
    return false;
  }
}

/** Mémorise que la première conversation a commencé : elle ne se relance pas à chaque ouverture. */
export function markFirstConversation(): void {
  try {
    window.localStorage.setItem(FIRST_CONVERSATION_KEY, "1");
  } catch {
    // Stockage indisponible : la conversation pourra recommencer au prochain lancement.
  }
}
