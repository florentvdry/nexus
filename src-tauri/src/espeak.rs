//! Phonétisation avec espeak-ng : le texte devient des phonèmes (IPA), que Kokoro transforme en parole.
//!
//! La bibliothèque `espeak-ng.dll` et ses données viennent de l'archive du moteur vocal, téléchargée et vérifiée par
//! `voice_tts`. Elle est chargée à l'exécution, pas liée à la compilation. espeak-ng n'est pas réentrant : chaque appel
//! passe par le même verrou, et la chaîne renvoyée est copiée avant tout nouvel appel.

use std::ffi::{c_char, c_int, c_void, CStr, CString};
use std::path::Path;
use std::sync::Mutex;

use libloading::Library;

use crate::error::AdapterError;

/// Fichier de la bibliothèque, dans le dossier de données d'espeak.
pub const LIBRARY_FILE: &str = "espeak-ng.dll";

type Initialize = unsafe extern "C" fn(c_int, c_int, *const c_char, c_int) -> c_int;
type SetVoiceByName = unsafe extern "C" fn(*const c_char) -> c_int;
type TextToPhonemes = unsafe extern "C" fn(*mut *const c_void, c_int, c_int) -> *const c_char;

/// espeak-ng n'ouvre aucun périphérique audio : le son reste à Kokoro.
const AUDIO_OUTPUT_SYNCHRONOUS: c_int = 2;
/// Le texte est en UTF-8.
const CHARS_UTF8: c_int = 1;
/// Les phonèmes sortent en alphabet phonétique international (IPA).
const PHONEMES_IPA: c_int = 0x02;

/// La bibliothèque est chargée une fois pour tout le processus, puis gardée avec ses fonctions.
struct Espeak {
    _library: Library,
    set_voice: SetVoiceByName,
    to_phonemes: TextToPhonemes,
}

static ENGINE: Mutex<Option<Espeak>> = Mutex::new(None);

fn failure(context: &str, error: impl std::fmt::Display) -> AdapterError {
    AdapterError::Operation(format!("{context} ({error})"))
}

impl Espeak {
    /// `dir` contient `espeak-ng.dll` et le dossier `espeak-ng-data`, qu'espeak lit à partir de ce dossier.
    fn load(dir: &Path) -> Result<Self, AdapterError> {
        let library_path = dir.join(LIBRARY_FILE);
        // SAFETY : la bibliothèque vient du dossier de données de NEXUS, installé et vérifié par `voice_tts`.
        let library = unsafe { Library::new(&library_path) }.map_err(|error| failure("moteur de phonétique indisponible", error))?;
        // SAFETY : les signatures reprennent celles de `speak_lib.h` d'espeak-ng.
        let (initialize, set_voice, to_phonemes) = unsafe {
            (
                *library.get::<Initialize>(b"espeak_Initialize").map_err(|error| failure("moteur de phonétique incompatible", error))?,
                *library.get::<SetVoiceByName>(b"espeak_SetVoiceByName").map_err(|error| failure("moteur de phonétique incompatible", error))?,
                *library.get::<TextToPhonemes>(b"espeak_TextToPhonemes").map_err(|error| failure("moteur de phonétique incompatible", error))?,
            )
        };
        let data = CString::new(dir.display().to_string()).map_err(|error| failure("dossier du moteur de phonétique", error))?;
        // SAFETY : `data` reste vivant pendant l'appel ; espeak copie le chemin.
        let rate = unsafe { initialize(AUDIO_OUTPUT_SYNCHRONOUS, 0, data.as_ptr(), 0) };
        if rate <= 0 {
            return Err(AdapterError::Operation("le moteur de phonétique n'a pas pu démarrer (données absentes ?)".into()));
        }
        Ok(Self { _library: library, set_voice, to_phonemes })
    }
}

/// Phonèmes IPA d'un texte, dans la langue de la voix espeak (`fr`, `en-us`). Le premier appel charge la bibliothèque.
pub fn phonemes(dir: &Path, voice: &str, text: &str) -> Result<String, AdapterError> {
    let mut slot = ENGINE.lock().map_err(|_| AdapterError::TaskFailed("verrou du moteur de phonétique".into()))?;
    if slot.is_none() {
        *slot = Some(Espeak::load(dir)?);
    }
    let engine = slot.as_ref().ok_or_else(|| AdapterError::TaskFailed("moteur de phonétique absent".into()))?;
    let voice = CString::new(voice).map_err(|error| failure("voix de phonétique invalide", error))?;
    let text = CString::new(text).map_err(|error| failure("texte invalide pour la phonétique", error))?;

    // SAFETY : les pointeurs restent valides pendant chaque appel ; la chaîne renvoyée est copiée avant l'appel suivant.
    unsafe {
        if (engine.set_voice)(voice.as_ptr()) != 0 {
            return Err(AdapterError::Operation("voix de phonétique inconnue".into()));
        }
        let mut cursor = text.as_ptr() as *const c_void;
        let mut out = String::new();
        while !cursor.is_null() {
            let part = (engine.to_phonemes)(&mut cursor, CHARS_UTF8, PHONEMES_IPA);
            if part.is_null() {
                break;
            }
            out.push_str(&CStr::from_ptr(part).to_string_lossy());
        }
        Ok(out.trim().to_string())
    }
}
