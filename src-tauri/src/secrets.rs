//! Protection des secrets au repos : DPAPI de Windows, liée au compte de l'utilisateur sur ce poste. Un fichier chiffré
//! ne se lit que sous ce compte. Hors Windows, aucune protection n'est disponible : `protect` échoue, et NEXUS refuse
//! d'écrire un secret en clair plutôt que de le stocker sans protection.

use crate::error::AdapterError;

/// Chiffre des octets pour le compte courant (DPAPI, sans prompt, sans entropie supplémentaire).
pub fn protect(plain: &[u8]) -> Result<Vec<u8>, AdapterError> {
    platform::protect(plain).map_err(|reason| AdapterError::Operation(format!("protection des secrets indisponible ({reason})")))
}

/// Déchiffre une valeur produite par `protect` sur ce compte. Une valeur d'un autre compte ou corrompue est refusée.
pub fn unprotect(cipher: &[u8]) -> Result<Vec<u8>, AdapterError> {
    platform::unprotect(cipher).map_err(|reason| AdapterError::Operation(format!("secret illisible ({reason})")))
}

/// Encodage hexadécimal, pour écrire un blob chiffré dans un fichier JSON.
pub fn to_hex(bytes: &[u8]) -> String {
    bytes.iter().map(|byte| format!("{byte:02x}")).collect()
}

pub fn from_hex(text: &str) -> Option<Vec<u8>> {
    if !text.len().is_multiple_of(2) || !text.is_ascii() {
        return None;
    }
    (0..text.len()).step_by(2).map(|index| u8::from_str_radix(&text[index..index + 2], 16).ok()).collect()
}

#[cfg(windows)]
mod platform {
    use windows::core::PCWSTR;
    use windows::Win32::Foundation::{LocalFree, HLOCAL};
    use windows::Win32::Security::Cryptography::{CryptProtectData, CryptUnprotectData, CRYPTPROTECT_UI_FORBIDDEN, CRYPT_INTEGER_BLOB};

    /// Copie le blob renvoyé par DPAPI, puis libère la mémoire allouée par Windows.
    fn take(blob: CRYPT_INTEGER_BLOB) -> Vec<u8> {
        if blob.pbData.is_null() {
            return Vec::new();
        }
        // SAFETY: DPAPI renvoie un pointeur valide de `cbData` octets, libéré ici une seule fois.
        unsafe {
            let bytes = std::slice::from_raw_parts(blob.pbData, blob.cbData as usize).to_vec();
            LocalFree(Some(HLOCAL(blob.pbData as *mut core::ffi::c_void)));
            bytes
        }
    }

    pub fn protect(plain: &[u8]) -> Result<Vec<u8>, String> {
        let input = CRYPT_INTEGER_BLOB { cbData: u32::try_from(plain.len()).map_err(|_| "donnée trop grande".to_string())?, pbData: plain.as_ptr() as *mut u8 };
        let mut output = CRYPT_INTEGER_BLOB::default();
        // SAFETY: `input` pointe sur `plain`, vivant pendant l'appel ; la sortie est libérée par `take`.
        unsafe { CryptProtectData(&input, PCWSTR::null(), None, None, None, CRYPTPROTECT_UI_FORBIDDEN, &mut output) }.map_err(|error| error.message())?;
        Ok(take(output))
    }

    pub fn unprotect(cipher: &[u8]) -> Result<Vec<u8>, String> {
        let input = CRYPT_INTEGER_BLOB { cbData: u32::try_from(cipher.len()).map_err(|_| "donnée trop grande".to_string())?, pbData: cipher.as_ptr() as *mut u8 };
        let mut output = CRYPT_INTEGER_BLOB::default();
        // SAFETY: même contrat que `protect`.
        unsafe { CryptUnprotectData(&input, None, None, None, None, CRYPTPROTECT_UI_FORBIDDEN, &mut output) }.map_err(|error| error.message())?;
        Ok(take(output))
    }
}

#[cfg(not(windows))]
mod platform {
    pub fn protect(_plain: &[u8]) -> Result<Vec<u8>, String> {
        Err("DPAPI n'existe que sous Windows".into())
    }

    pub fn unprotect(_cipher: &[u8]) -> Result<Vec<u8>, String> {
        Err("DPAPI n'existe que sous Windows".into())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn hex_round_trips_and_rejects_malformed_text() {
        let bytes = [0u8, 15, 16, 255];
        assert_eq!(from_hex(&to_hex(&bytes)).unwrap(), bytes);
        assert!(from_hex("abc").is_none());
        assert!(from_hex("zz").is_none());
    }

    #[cfg(windows)]
    #[test]
    fn a_protected_value_is_not_plain_text_and_comes_back_intact() {
        let secret = b"jeton-de-test-sans-valeur-reelle";
        let cipher = protect(secret).unwrap();
        assert!(!cipher.windows(secret.len()).any(|window| window == secret), "le secret ne doit pas apparaître en clair");
        assert_eq!(unprotect(&cipher).unwrap(), secret);
    }

    #[cfg(windows)]
    #[test]
    fn a_corrupted_value_is_refused() {
        let mut cipher = protect(b"valeur").unwrap();
        let last = cipher.len() - 1;
        cipher[last] ^= 0xff;
        cipher.truncate(cipher.len() - 4);
        assert!(unprotect(&cipher).is_err());
    }

    #[cfg(not(windows))]
    #[test]
    fn without_windows_no_secret_is_stored_in_clear() {
        assert!(protect(b"valeur").is_err());
    }
}
