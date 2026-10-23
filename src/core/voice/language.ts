import { normalize } from "../intent/normalize";
import type { VoiceLanguage } from "./types";

/** Mots fréquents : une détection par comptage, sans modèle. Suffisante pour choisir la langue d'une réponse. */
const FRENCH = new Set(normalize("le la les des du un une et est je tu mon ma mes ce cette avec pour dans sur bonjour lance ouvre ferme affiche montre moi processeur fenetre utilisation ordinateur merci").split(" "));
const ENGLISH = new Set(normalize("the a an and is are my this that open close show start launch please computer window cpu memory of to for with hello thanks").split(" "));

/** Langue probable d'un texte, ou `undefined` si les indices sont absents ou contradictoires. */
export function detectTextLanguage(text: string): VoiceLanguage | undefined {
  let french = 0;
  let english = 0;
  for (const token of normalize(text).split(" ")) {
    if (FRENCH.has(token)) french += 1;
    if (ENGLISH.has(token)) english += 1;
  }
  if (french === english) return undefined;
  return french > english ? "fr" : "en";
}
