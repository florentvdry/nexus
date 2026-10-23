//! Validateur officiel des plugins NEXUS, utilisable en local et en CI :
//!
//! `nexus-plugin validate <dossier>` : vérifie le manifeste, les fichiers et leur contenu. Code de sortie 0 si valide.
//! `nexus-plugin digest <dossier>`   : affiche l'empreinte SHA-256 que l'application affichera à l'installation.

use std::path::PathBuf;
use std::process::ExitCode;

use nexus_lib::error::AdapterError;
use nexus_lib::plugin_store::{check, manifest, sandbox::Sandbox};
use nexus_lib::plugins::actions::apps::CATALOG;

fn main() -> ExitCode {
    let mut args = std::env::args().skip(1);
    let (Some(command), Some(folder)) = (args.next(), args.next()) else {
        eprintln!("usage : nexus-plugin validate <dossier> | nexus-plugin digest <dossier>");
        return ExitCode::from(2);
    };
    let dir = PathBuf::from(folder);
    if !dir.is_dir() {
        eprintln!("dossier introuvable : {}", dir.display());
        return ExitCode::from(2);
    }
    let known: Vec<&str> = CATALOG.iter().map(|spec| spec.id).collect();
    match command.as_str() {
        "validate" => {
            let sandbox = match Sandbox::new() {
                Ok(sandbox) => sandbox,
                Err(error) => {
                    eprintln!("{error}");
                    return ExitCode::FAILURE;
                }
            };
            let problems = check::check_dir(&dir, &known, &sandbox);
            if problems.is_empty() {
                let text = std::fs::read_to_string(dir.join(manifest::MANIFEST_FILE)).unwrap_or_default();
                let parsed = manifest::parse(&text);
                match parsed {
                    Ok(found) => println!("valide : {} {} ({})", found.id, found.version, found.kinds.join(", ")),
                    Err(error) => println!("valide : {error}"),
                }
                ExitCode::SUCCESS
            } else {
                for problem in &problems {
                    eprintln!("- {problem}");
                }
                ExitCode::FAILURE
            }
        }
        "digest" => match check::list_files(&dir).and_then(|files| check::digest(&files)) {
            Ok(digest) => {
                println!("{digest}");
                ExitCode::SUCCESS
            }
            Err(problem) => {
                eprintln!("{}", AdapterError::PluginInvalid(problem));
                ExitCode::FAILURE
            }
        },
        _ => {
            eprintln!("commande inconnue : {command}");
            ExitCode::from(2)
        }
    }
}
