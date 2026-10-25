//! Lancement d'un connecteur dans un conteneur d'application Windows (AppContainer). Expérimental : ce module n'est pas
//! utilisé par le lancement des connecteurs tant que ses mesures ne sont pas concluantes (voir `docs/PERMISSIONS.md`).
//!
//! Dans un AppContainer, un processus n'accède aux fichiers que s'ils sont explicitement accordés à son identité, et il
//! n'a pas de réseau sans la capacité `internetClient`. Les entrées et sorties passent par des tubes anonymes.

use std::ffi::c_void;
use std::fs::File;
use std::os::windows::io::FromRawHandle;

use windows::core::{PCWSTR, PWSTR};
use windows::Win32::Foundation::{CloseHandle, SetHandleInformation, HANDLE, HANDLE_FLAG_INHERIT, HLOCAL, LocalFree, WAIT_OBJECT_0};
use windows::Win32::Security::Isolation::{CreateAppContainerProfile, DeriveAppContainerSidFromAppContainerName};
use windows::Win32::Security::Authorization::ConvertStringSidToSidW;
use windows::Win32::Security::{FreeSid, SECURITY_ATTRIBUTES, SECURITY_CAPABILITIES, PSID, SID_AND_ATTRIBUTES};
use windows::Win32::System::Pipes::CreatePipe;
use windows::Win32::System::Threading::{
    CreateProcessW, DeleteProcThreadAttributeList, GetExitCodeProcess, InitializeProcThreadAttributeList, TerminateProcess, UpdateProcThreadAttribute,
    WaitForSingleObject, EXTENDED_STARTUPINFO_PRESENT, LPPROC_THREAD_ATTRIBUTE_LIST, PROCESS_INFORMATION, PROC_THREAD_ATTRIBUTE_SECURITY_CAPABILITIES,
    STARTF_USESTDHANDLES, STARTUPINFOEXW, STARTUPINFOW,
};

use crate::error::AdapterError;

/// Nom du conteneur propre à NEXUS. Son identité est dérivée du nom, donc stable d'un lancement à l'autre.
pub const CONTAINER_NAME: &str = "NEXUS.Connector";
/// Capacité « client Internet » : sans elle, le conteneur n'ouvre aucune connexion réseau.
const INTERNET_CLIENT_SID: &str = "S-1-15-3-1";
const SE_GROUP_ENABLED: u32 = 0x0000_0004;
const CREATE_NO_WINDOW: u32 = 0x0800_0000;
const CREATE_UNICODE_ENVIRONMENT: u32 = 0x0000_0400;

fn wide(text: &str) -> Vec<u16> {
    text.encode_utf16().chain(std::iter::once(0)).collect()
}

/// Identité du conteneur NEXUS : créée au premier usage, puis retrouvée par son nom.
pub struct ContainerSid(PSID);

impl ContainerSid {
    pub fn get_or_create() -> Result<ContainerSid, AdapterError> {
        let name = wide(CONTAINER_NAME);
        // SAFETY: chaînes terminées par un zéro, vivantes pendant l'appel. Le SID renvoyé est libéré par `Drop`.
        let sid = unsafe {
            match CreateAppContainerProfile(PCWSTR(name.as_ptr()), PCWSTR(name.as_ptr()), PCWSTR(name.as_ptr()), None) {
                Ok(sid) => sid,
                Err(_) => DeriveAppContainerSidFromAppContainerName(PCWSTR(name.as_ptr())).map_err(|error| AdapterError::Operation(format!("conteneur : {error}")))?,
            }
        };
        Ok(ContainerSid(sid))
    }
}

impl Drop for ContainerSid {
    fn drop(&mut self) {
        // SAFETY: SID alloué par Windows pour ce conteneur, libéré une seule fois.
        unsafe {
            FreeSid(self.0);
        }
    }
}

/// Processus lancé dans le conteneur, avec ses tubes d'entrée et de sortie.
pub struct Contained {
    pub process: HANDLE,
    pub stdin: File,
    pub stdout: File,
}

impl Drop for Contained {
    fn drop(&mut self) {
        // SAFETY: descripteurs ouverts par `spawn` et non encore fermés.
        unsafe {
            let _ = TerminateProcess(self.process, 1);
            let _ = WaitForSingleObject(self.process, 5_000);
            let _ = CloseHandle(self.process);
        }
    }
}

impl Contained {
    /// Code de sortie, ou `None` si le processus tourne encore.
    pub fn exit_code(&self) -> Option<u32> {
        let mut code = 0u32;
        // SAFETY: descripteur de processus valide tant que `self` existe.
        unsafe {
            if WaitForSingleObject(self.process, 0) == WAIT_OBJECT_0 && GetExitCodeProcess(self.process, &mut code).is_ok() {
                return Some(code);
            }
        }
        None
    }
}

/// Lance `command_line` dans le conteneur. `network` accorde la capacité Internet ; sinon le réseau est fermé.
pub fn spawn(command_line: &str, environment: &[(String, String)], network: bool) -> Result<Contained, AdapterError> {
    let sid = ContainerSid::get_or_create()?;
    let mut capabilities: Vec<SID_AND_ATTRIBUTES> = Vec::new();
    let mut internet_sid = PSID::default();
    if network {
        let text = wide(INTERNET_CLIENT_SID);
        // SAFETY: chaîne SID terminée par un zéro ; le SID alloué est libéré juste après la création du processus.
        unsafe { ConvertStringSidToSidW(PCWSTR(text.as_ptr()), &mut internet_sid) }.map_err(|error| AdapterError::Operation(format!("capacité réseau : {error}")))?;
        capabilities.push(SID_AND_ATTRIBUTES { Sid: internet_sid, Attributes: SE_GROUP_ENABLED });
    }
    let result = spawn_with(&sid, &capabilities, command_line, environment);
    if !internet_sid.0.is_null() {
        // SAFETY: SID alloué par ConvertStringSidToSidW.
        unsafe {
            LocalFree(Some(HLOCAL(internet_sid.0)));
        }
    }
    result
}

fn spawn_with(sid: &ContainerSid, capabilities: &[SID_AND_ATTRIBUTES], command_line: &str, environment: &[(String, String)]) -> Result<Contained, AdapterError> {
    let operation = |what: &str, error: windows::core::Error| AdapterError::Operation(format!("{what} : {error}"));
    let inheritable = SECURITY_ATTRIBUTES { nLength: std::mem::size_of::<SECURITY_ATTRIBUTES>() as u32, lpSecurityDescriptor: std::ptr::null_mut(), bInheritHandle: true.into() };
    let (mut stdin_read, mut stdin_write, mut stdout_read, mut stdout_write) = (HANDLE::default(), HANDLE::default(), HANDLE::default(), HANDLE::default());
    // SAFETY: les tubes sont créés avec des descripteurs valides ; seules les moitiés enfant héritent.
    unsafe {
        CreatePipe(&mut stdin_read, &mut stdin_write, Some(&inheritable), 0).map_err(|error| operation("tube d'entrée", error))?;
        CreatePipe(&mut stdout_read, &mut stdout_write, Some(&inheritable), 0).map_err(|error| operation("tube de sortie", error))?;
        SetHandleInformation(stdin_write, HANDLE_FLAG_INHERIT.0, Default::default()).map_err(|error| operation("tube d'entrée", error))?;
        SetHandleInformation(stdout_read, HANDLE_FLAG_INHERIT.0, Default::default()).map_err(|error| operation("tube de sortie", error))?;
    }

    let security = SECURITY_CAPABILITIES {
        AppContainerSid: sid.0,
        Capabilities: if capabilities.is_empty() { std::ptr::null_mut() } else { capabilities.as_ptr() as *mut SID_AND_ATTRIBUTES },
        CapabilityCount: capabilities.len() as u32,
        Reserved: 0,
    };
    let mut size = 0usize;
    // SAFETY: première passe pour connaître la taille de la liste d'attributs, puis initialisation dans un tampon de cette taille.
    unsafe {
        let _ = InitializeProcThreadAttributeList(None, 1, None, &mut size);
    }
    let mut buffer = vec![0u8; size];
    let list = LPPROC_THREAD_ATTRIBUTE_LIST(buffer.as_mut_ptr() as *mut c_void);
    // SAFETY: tampon de la taille demandée ; la liste est détruite avant la fin de la fonction.
    unsafe {
        InitializeProcThreadAttributeList(Some(list), 1, None, &mut size).map_err(|error| operation("liste d'attributs", error))?;
        UpdateProcThreadAttribute(
            list,
            0,
            PROC_THREAD_ATTRIBUTE_SECURITY_CAPABILITIES as usize,
            Some(&security as *const SECURITY_CAPABILITIES as *const c_void),
            std::mem::size_of::<SECURITY_CAPABILITIES>(),
            None,
            None,
        )
        .map_err(|error| operation("conteneur", error))?;
    }

    let startup = STARTUPINFOEXW {
        StartupInfo: STARTUPINFOW {
            cb: std::mem::size_of::<STARTUPINFOEXW>() as u32,
            dwFlags: STARTF_USESTDHANDLES,
            hStdInput: stdin_read,
            hStdOutput: stdout_write,
            hStdError: stdout_write,
            ..Default::default()
        },
        lpAttributeList: list,
    };
    let mut command = wide(command_line);
    let mut block: Vec<u16> = Vec::new();
    // Windows attend le bloc trié par nom (insensible à la casse).
    let mut sorted: Vec<&(String, String)> = environment.iter().collect();
    sorted.sort_by_key(|(name, _)| name.to_uppercase());
    for (name, value) in sorted {
        block.extend(format!("{name}={value}").encode_utf16());
        block.push(0);
    }
    // Un bloc vide est remplacé par un pointeur nul : le conteneur hérite alors de l environnement du parent.
    block.push(0);
    let mut information = PROCESS_INFORMATION::default();
    // SAFETY: tous les pointeurs vivent pendant l'appel ; le processus et son fil sont fermés par `Contained` ou ci-dessous.
    let created = unsafe {
        CreateProcessW(
            PCWSTR::null(),
            Some(PWSTR(command.as_mut_ptr())),
            None,
            None,
            true,
            EXTENDED_STARTUPINFO_PRESENT | windows::Win32::System::Threading::PROCESS_CREATION_FLAGS(CREATE_NO_WINDOW | CREATE_UNICODE_ENVIRONMENT),
            if environment.is_empty() { None } else { Some(block.as_ptr() as *const c_void) },
            PCWSTR::null(),
            &startup.StartupInfo as *const STARTUPINFOW,
            &mut information,
        )
    };
    // SAFETY: le tampon et la liste ne servent plus ; les moitiés enfant ne sont plus nécessaires côté NEXUS.
    unsafe {
        DeleteProcThreadAttributeList(list);
        let _ = CloseHandle(stdin_read);
        let _ = CloseHandle(stdout_write);
    }
    if let Err(error) = created {
        // SAFETY: descripteurs parents créés plus haut, non encore transférés.
        unsafe {
            let _ = CloseHandle(stdin_write);
            let _ = CloseHandle(stdout_read);
        }
        return Err(operation("lancement dans le conteneur", error));
    }
    // SAFETY: le fil principal du processus n'est pas utilisé ; on ne garde que le descripteur de processus.
    unsafe {
        let _ = CloseHandle(information.hThread);
    }
    // SAFETY: descripteurs parents, transférés à des `File` qui les fermeront.
    let (stdin, stdout) = unsafe { (File::from_raw_handle(stdin_write.0), File::from_raw_handle(stdout_read.0)) };
    Ok(Contained { process: information.hProcess, stdin, stdout })
}

/// Identité du conteneur sous forme de texte (`S-1-15-2-…`), pour accorder un dossier avec `icacls`.
pub fn container_sid_string() -> Result<String, AdapterError> {
    use windows::Win32::Security::Authorization::ConvertSidToStringSidW;
    let sid = ContainerSid::get_or_create()?;
    let mut text = PWSTR::null();
    // SAFETY: SID valide ; la chaîne allouée par Windows est copiée puis libérée.
    unsafe {
        ConvertSidToStringSidW(sid.0, &mut text).map_err(|error| AdapterError::Operation(format!("identité du conteneur : {error}")))?;
        let value = text.to_string().unwrap_or_default();
        LocalFree(Some(HLOCAL(text.0 as *mut c_void)));
        Ok(value)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::{Read, Write};

    /// Lance une commande dans le conteneur et renvoie sa sortie, avec un délai de sécurité.
    fn run(command: &str, network: bool) -> String {
        let mut contained = spawn(command, &[], network).expect("lancement");
        let mut output = String::new();
        let started = std::time::Instant::now();
        let mut buffer = [0u8; 4096];
        loop {
            match contained.stdout.read(&mut buffer) {
                Ok(0) | Err(_) => break,
                Ok(read) => output.push_str(&String::from_utf8_lossy(&buffer[..read])),
            }
            if started.elapsed() > std::time::Duration::from_secs(60) {
                break;
            }
        }
        let _ = contained.stdin.flush();
        output
    }

    #[test]
    #[ignore = "expérience Windows : à lancer avec --ignored"]
    fn a_contained_process_talks_over_its_pipes() {
        assert!(run("cmd.exe /c echo bonjour-du-conteneur", false).contains("bonjour-du-conteneur"));
    }

    #[test]
    #[ignore = "expérience Windows : à lancer avec --ignored"]
    fn a_contained_process_cannot_read_the_user_documents() {
        let file = std::path::PathBuf::from(std::env::var("USERPROFILE").unwrap()).join("Documents").join("nexus-container-probe.txt");
        std::fs::write(&file, "sonde").unwrap();
        let output = run(&format!("cmd.exe /c type \"{}\"", file.display()), false);
        let _ = std::fs::remove_file(&file);
        // Le refus doit venir de Windows (accès refusé), pas d'un processus qui n'a rien pu lancer.
        assert!(!output.contains("sonde"), "le conteneur lit les documents : {output}");
        assert!(output.contains("refus") || output.to_lowercase().contains("denied"), "pas de refus d'accès visible : {output}");
    }

    /// npm dans le conteneur : cache et fichiers temporaires dans un dossier accordé au seul conteneur, réseau ouvert.
    #[test]
    #[ignore = "échoue : Windows refuse un bloc d environnement dans le conteneur (0x800700CB)"]
    fn npm_view_works_inside_the_container_with_a_granted_cache() {
        let sid = container_sid_string().expect("identité du conteneur");
        let cache = std::path::PathBuf::from(std::env::var("LOCALAPPDATA").unwrap()).join("NEXUS-experience").join("npm-cache");
        std::fs::create_dir_all(&cache).unwrap();
        let grant = std::process::Command::new("icacls")
            .arg(&cache)
            .args(["/grant", &format!("*{sid}:(OI)(CI)M")])
            .output()
            .expect("icacls");
        assert!(grant.status.success(), "{}", String::from_utf8_lossy(&grant.stderr));
        // Bloc d'environnement non vide : Windows le refuse dans le conteneur (voir docs/PERMISSIONS.md). Test gardé pour
        // reproduire le problème ; `spawn` accepte un bloc vide, qui hérite de l'environnement du parent.
        let environment = vec![("NEXUS_X".to_string(), "1".to_string())];
        let mut contained = spawn("cmd.exe /c npm.cmd view left-pad version", &environment, true).expect("lancement");
        let mut output = String::new();
        let mut buffer = [0u8; 4096];
        let started = std::time::Instant::now();
        while started.elapsed() < std::time::Duration::from_secs(90) {
            match contained.stdout.read(&mut buffer) {
                Ok(0) | Err(_) => break,
                Ok(read) => output.push_str(&String::from_utf8_lossy(&buffer[..read])),
            }
        }
        eprintln!("npm view : {output}");
        assert!(output.trim().chars().next().is_some_and(|c| c.is_ascii_digit()), "npm n'a pas répondu : {output}");
    }

    #[test]
    #[ignore = "expérience Windows : à lancer avec --ignored"]
    fn the_network_opens_only_with_the_internet_capability() {
        let probe = "powershell.exe -NoProfile -Command \"try { (Invoke-WebRequest -UseBasicParsing -Uri https://registry.npmjs.org/ -TimeoutSec 15).StatusCode } catch { 'ECHEC' }\"";
        assert!(run(probe, false).contains("ECHEC"), "réseau ouvert sans capacité");
        assert!(run(probe, true).contains("200"), "réseau fermé avec la capacité");
    }
}
