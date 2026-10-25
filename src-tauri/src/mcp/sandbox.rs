//! Isolation des connecteurs lancés sur ce poste. Un connecteur est du code tiers exécuté avec les droits de l'utilisateur :
//! NEXUS limite ce qu'il peut faire à ce qui est réaliste sous Windows sans droits d'administrateur.
//!
//! Ce qui est fait :
//! - un *job object* par session : tout processus lancé par le connecteur (cmd, node, enfants) est arrêté quand la
//!   session se termine, y compris si NEXUS plante ; le nombre de processus et la mémoire de chacun sont bornés ;
//! - un environnement réduit : seules quelques variables système sont transmises, plus celles du connecteur. Les
//!   variables de NEXUS et de l'utilisateur (jetons, clés) ne sont pas héritées.
//!
//! Ce qui n'est PAS fait : pas de restriction réseau ni de restriction de fichiers. Un job object ne les limite pas, et
//! une isolation complète (AppContainer, bac à sable Windows) reste à décider. Voir `docs/PERMISSIONS.md`.

use std::process::Command;

/// Environnement transmis au connecteur, hors variables du connecteur : ce qu'il faut à Windows et à npm pour démarrer.
const INHERITED_ENV: &[&str] = &[
    "SystemRoot",
    "SystemDrive",
    "PATH",
    "PATHEXT",
    "COMSPEC",
    "USERPROFILE",
    "HOMEDRIVE",
    "HOMEPATH",
    "APPDATA",
    "LOCALAPPDATA",
    "TEMP",
    "TMP",
    "ProgramData",
    "ProgramFiles",
    "ProgramFiles(x86)",
];

/// Processus au plus par connecteur (le serveur et les processus qu'il lance).
pub const MAX_PROCESSES: u32 = 64;
/// Mémoire au plus par processus du connecteur.
pub const MAX_PROCESS_MEMORY: usize = 2 * 1024 * 1024 * 1024;

/// Vide l'environnement du connecteur, puis n'y remet que ce qui est nécessaire, plus ses propres variables.
pub fn isolate_environment(command: &mut Command, connector_env: &[(String, String)]) {
    command.env_clear();
    for name in INHERITED_ENV {
        if let Ok(value) = std::env::var(name) {
            command.env(name, value);
        }
    }
    command.envs(connector_env.iter().map(|(name, value)| (name.as_str(), value.as_str())));
}

#[cfg(windows)]
pub use windows_job::Job;

#[cfg(windows)]
mod windows_job {
    use std::ffi::c_void;
    use std::os::windows::io::AsRawHandle;
    use std::process::Child;

    use windows::core::PCWSTR;
    use windows::Win32::Foundation::{CloseHandle, HANDLE};
    use windows::Win32::System::JobObjects::{
        AssignProcessToJobObject, CreateJobObjectW, JobObjectExtendedLimitInformation, SetInformationJobObject, JOBOBJECT_EXTENDED_LIMIT_INFORMATION,
        JOB_OBJECT_LIMIT_ACTIVE_PROCESS, JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE, JOB_OBJECT_LIMIT_PROCESS_MEMORY,
    };

    use super::{MAX_PROCESSES, MAX_PROCESS_MEMORY};
    use crate::error::AdapterError;

    /// Job object : fermer son dernier descripteur arrête tous les processus qu'il contient.
    pub struct Job(HANDLE);

    impl Job {
        pub fn new() -> Result<Job, AdapterError> {
            // SAFETY: création d'un job anonyme, sans attributs de sécurité ni nom ; le descripteur est fermé par `Drop`.
            let handle = unsafe { CreateJobObjectW(None, PCWSTR::null()) }.map_err(|error| AdapterError::Operation(format!("isolation du connecteur : {error}")))?;
            let job = Job(handle);
            let mut limits = JOBOBJECT_EXTENDED_LIMIT_INFORMATION::default();
            limits.BasicLimitInformation.LimitFlags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE | JOB_OBJECT_LIMIT_ACTIVE_PROCESS | JOB_OBJECT_LIMIT_PROCESS_MEMORY;
            limits.BasicLimitInformation.ActiveProcessLimit = MAX_PROCESSES;
            limits.ProcessMemoryLimit = MAX_PROCESS_MEMORY;
            // SAFETY: la structure est initialisée et de la taille annoncée ; le job appartient à `job`.
            unsafe {
                SetInformationJobObject(
                    job.0,
                    JobObjectExtendedLimitInformation,
                    &limits as *const JOBOBJECT_EXTENDED_LIMIT_INFORMATION as *const c_void,
                    std::mem::size_of::<JOBOBJECT_EXTENDED_LIMIT_INFORMATION>() as u32,
                )
            }
            .map_err(|error| AdapterError::Operation(format!("limites du connecteur : {error}")))?;
            Ok(job)
        }

        /// Place le processus dans le job. À faire tout de suite après le lancement.
        pub fn assign(&self, child: &Child) -> Result<(), AdapterError> {
            let process = HANDLE(child.as_raw_handle());
            // SAFETY: les deux descripteurs sont valides : le job est ouvert, et le processus est celui de `child`.
            unsafe { AssignProcessToJobObject(self.0, process) }.map_err(|error| AdapterError::Operation(format!("isolation du connecteur : {error}")))
        }
    }

    impl Drop for Job {
        fn drop(&mut self) {
            // SAFETY: descripteur ouvert par `new`, fermé une seule fois. Sa fermeture arrête les processus du job.
            let _ = unsafe { CloseHandle(self.0) };
        }
    }
}
