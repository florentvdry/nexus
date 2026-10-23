//! Catalogue fermé des applications lançables.
//!
//! Le frontend ne transmet jamais de commande : il transmet un identifiant du catalogue.
//! Chaque entrée liste des emplacements candidats (chemins avec variables d'environnement
//! Windows ou simple nom d'exécutable cherché dans le PATH). Le premier candidat présent
//! sur la machine est utilisé ; sinon l'application est signalée comme non installée.

use std::path::{Path, PathBuf};

use serde::Serialize;

use crate::error::AdapterError;

#[derive(Debug, Clone, Copy)]
pub struct Candidate {
    pub program: &'static str,
    pub args: &'static [&'static str],
}

#[derive(Debug, Clone, Copy)]
pub struct AppSpec {
    pub id: &'static str,
    pub display_name: &'static str,
    pub candidates: &'static [Candidate],
}

pub const CATALOG: &[AppSpec] = &[
    AppSpec {
        id: "notepad",
        display_name: "Bloc-notes",
        candidates: &[Candidate { program: "notepad.exe", args: &[] }],
    },
    AppSpec {
        id: "calculator",
        display_name: "Calculatrice",
        candidates: &[Candidate { program: "calc.exe", args: &[] }],
    },
    AppSpec {
        id: "paint",
        display_name: "Paint",
        candidates: &[Candidate { program: "mspaint.exe", args: &[] }],
    },
    AppSpec {
        id: "file-explorer",
        display_name: "Explorateur de fichiers",
        candidates: &[Candidate { program: "explorer.exe", args: &[] }],
    },
    AppSpec {
        id: "chrome",
        display_name: "Google Chrome",
        candidates: &[
            Candidate {
                program: "%ProgramFiles%\\Google\\Chrome\\Application\\chrome.exe",
                args: &[],
            },
            Candidate {
                program: "%ProgramFiles(x86)%\\Google\\Chrome\\Application\\chrome.exe",
                args: &[],
            },
            Candidate {
                program: "%LOCALAPPDATA%\\Google\\Chrome\\Application\\chrome.exe",
                args: &[],
            },
        ],
    },
    AppSpec {
        id: "discord",
        display_name: "Discord",
        candidates: &[Candidate {
            program: "%LOCALAPPDATA%\\Discord\\Update.exe",
            args: &["--processStart", "Discord.exe"],
        }],
    },
];

/// Accès à l'environnement de la machine, injectable pour les tests.
pub trait Environment {
    fn var(&self, name: &str) -> Option<String>;
    fn path_dirs(&self) -> Vec<PathBuf>;
    fn is_file(&self, path: &Path) -> bool;
}

pub struct OsEnvironment;

impl Environment for OsEnvironment {
    fn var(&self, name: &str) -> Option<String> {
        std::env::var(name).ok()
    }

    fn path_dirs(&self) -> Vec<PathBuf> {
        std::env::var_os("PATH")
            .map(|value| std::env::split_paths(&value).collect())
            .unwrap_or_default()
    }

    fn is_file(&self, path: &Path) -> bool {
        path.is_file()
    }
}

#[derive(Debug, Clone, PartialEq)]
pub struct ResolvedCommand {
    pub program: PathBuf,
    pub args: Vec<String>,
}

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct AppStatus {
    pub id: String,
    pub display_name: String,
    pub installed: bool,
}

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct LaunchOutcome {
    pub app_id: String,
    pub display_name: String,
    pub pid: u32,
}

/// Remplace les segments `%NOM%` par la valeur de la variable. `None` si une variable manque.
fn expand_variables(template: &str, env: &dyn Environment) -> Option<String> {
    let mut expanded = String::new();
    for (index, segment) in template.split('%').enumerate() {
        if index % 2 == 0 {
            expanded.push_str(segment);
        } else {
            expanded.push_str(&env.var(segment)?);
        }
    }
    Some(expanded)
}

fn resolve_candidate(candidate: &Candidate, env: &dyn Environment) -> Option<PathBuf> {
    if candidate.program.contains('%') {
        let path = PathBuf::from(expand_variables(candidate.program, env)?);
        return env.is_file(&path).then_some(path);
    }
    if candidate.program.contains(['\\', '/']) {
        let path = PathBuf::from(candidate.program);
        return env.is_file(&path).then_some(path);
    }
    env.path_dirs()
        .into_iter()
        .map(|dir| dir.join(candidate.program))
        .find(|path| env.is_file(path))
}

/// Trouve la commande réelle d'une application du catalogue.
pub fn resolve(spec: &AppSpec, env: &dyn Environment) -> Option<ResolvedCommand> {
    spec.candidates.iter().find_map(|candidate| {
        resolve_candidate(candidate, env).map(|program| ResolvedCommand {
            program,
            args: candidate.args.iter().map(|arg| arg.to_string()).collect(),
        })
    })
}

pub fn find_spec(app_id: &str) -> Result<&'static AppSpec, AdapterError> {
    CATALOG
        .iter()
        .find(|spec| spec.id == app_id)
        .ok_or_else(|| AdapterError::UnknownApp(app_id.to_string()))
}

pub fn list(env: &dyn Environment) -> Vec<AppStatus> {
    CATALOG
        .iter()
        .map(|spec| AppStatus {
            id: spec.id.to_string(),
            display_name: spec.display_name.to_string(),
            installed: resolve(spec, env).is_some(),
        })
        .collect()
}

/// Lance l'application puis rend la main immédiatement, sans attendre sa fermeture.
pub fn launch(app_id: &str, env: &dyn Environment) -> Result<LaunchOutcome, AdapterError> {
    let spec = find_spec(app_id)?;
    let command = resolve(spec, env)
        .ok_or_else(|| AdapterError::NotInstalled(spec.display_name.to_string()))?;

    let child = std::process::Command::new(&command.program)
        .args(&command.args)
        .spawn()
        .map_err(|error| AdapterError::LaunchFailed(format!("{}: {error}", spec.display_name)))?;

    Ok(LaunchOutcome {
        app_id: spec.id.to_string(),
        display_name: spec.display_name.to_string(),
        pid: child.id(),
    })
}

#[cfg(test)]
mod tests {
    use std::collections::{HashMap, HashSet};

    use super::*;

    #[derive(Default)]
    struct FakeEnv {
        vars: HashMap<String, String>,
        path: Vec<PathBuf>,
        files: HashSet<PathBuf>,
    }

    impl Environment for FakeEnv {
        fn var(&self, name: &str) -> Option<String> {
            self.vars.get(name).cloned()
        }
        fn path_dirs(&self) -> Vec<PathBuf> {
            self.path.clone()
        }
        fn is_file(&self, path: &Path) -> bool {
            self.files.contains(path)
        }
    }

    fn spec(id: &str) -> &'static AppSpec {
        find_spec(id).expect("application présente dans le catalogue")
    }

    #[test]
    fn finds_bare_executable_through_path() {
        let env = FakeEnv {
            path: vec![PathBuf::from(r"C:\Windows\System32")],
            files: HashSet::from([PathBuf::from(r"C:\Windows\System32").join("notepad.exe")]),
            ..Default::default()
        };
        let resolved = resolve(spec("notepad"), &env).expect("bloc-notes trouvé");
        assert_eq!(resolved.program, PathBuf::from(r"C:\Windows\System32").join("notepad.exe"));
        assert!(resolved.args.is_empty());
    }

    #[test]
    fn expands_windows_variables_and_passes_arguments() {
        let discord = PathBuf::from(r"C:\Users\ana\AppData\Local\Discord\Update.exe");
        let env = FakeEnv {
            vars: HashMap::from([("LOCALAPPDATA".to_string(), r"C:\Users\ana\AppData\Local".to_string())]),
            files: HashSet::from([discord.clone()]),
            ..Default::default()
        };
        let resolved = resolve(spec("discord"), &env).expect("discord trouvé");
        assert_eq!(resolved.program, discord);
        assert_eq!(resolved.args, vec!["--processStart".to_string(), "Discord.exe".to_string()]);
    }

    #[test]
    fn missing_variable_skips_candidate_instead_of_guessing() {
        let env = FakeEnv::default();
        assert!(resolve(spec("discord"), &env).is_none());
    }

    #[test]
    fn unknown_application_is_rejected_before_any_lookup() {
        assert!(matches!(
            launch("powershell-as-admin", &FakeEnv::default()),
            Err(AdapterError::UnknownApp(_))
        ));
    }

    #[test]
    fn not_installed_application_is_reported_by_name() {
        let error = launch("calculator", &FakeEnv::default()).unwrap_err();
        assert!(matches!(error, AdapterError::NotInstalled(ref name) if name == "Calculatrice"));
    }

    #[test]
    fn list_reports_installed_state_for_every_entry() {
        let statuses = list(&FakeEnv::default());
        assert_eq!(statuses.len(), CATALOG.len());
        assert!(statuses.iter().all(|status| !status.installed));
    }
}
