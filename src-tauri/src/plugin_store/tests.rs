//! Parcours complets du magasin : préparation, approbation, installation, altération, suppression, Git.

use std::fs;
use std::path::{Path, PathBuf};
use std::process::Command;

use super::store::{self, State, Store};
use crate::error::AdapterError;

const MANIFEST: &str = r#"{"schemaVersion":1,"id":"community.ana.verbes","name":"Verbes","version":"1.0.0","author":"Ana",
    "description":"Vocabulaire supplémentaire.","engines":{"nexus":">=0.1.0 <1.0.0"},"kinds":["language"],
    "entryPoints":{"language":"language.json"},"permissions":[]}"#;
const LANGUAGE: &str = r#"{"locale":"fr","phrases":{"openVerbs":["ouvre","demarre"]},"fillers":["le"]}"#;

fn scratch(name: &str) -> PathBuf {
    let dir = std::env::temp_dir().join(format!("nexus-store-{}-{name}", std::process::id()));
    let _ = fs::remove_dir_all(&dir);
    fs::create_dir_all(&dir).unwrap();
    dir
}

fn plugin_folder(root: &Path, language: &str) -> PathBuf {
    let folder = root.join("source-plugin");
    fs::create_dir_all(&folder).unwrap();
    fs::write(folder.join("nexus.json"), MANIFEST).unwrap();
    fs::write(folder.join("language.json"), language).unwrap();
    folder
}

#[test]
fn a_plugin_is_prepared_approved_used_altered_and_removed() {
    let sandbox = scratch("flow");
    let store = Store::new(sandbox.join("plugins")).unwrap();

    let prepared = store.prepare_folder(&plugin_folder(&sandbox, LANGUAGE)).unwrap();
    assert_eq!(prepared.id, "community.ana.verbes");
    assert!(prepared.commit.is_none());
    // Rien n'est encore installé : le plugin attend l'accord de l'utilisateur.
    assert!(store.list().unwrap().is_empty());

    let installed = store.install(&prepared.staging_id, &prepared.digest).unwrap();
    assert_eq!(installed.state, State::Active);
    assert_eq!(store.list().unwrap().len(), 1);
    let packs = store.packs().unwrap();
    assert_eq!(packs.len(), 1);
    assert_eq!(packs[0].language.as_ref().unwrap().locale, "fr");

    // Une modification après approbation désactive le plugin, sans rien charger.
    fs::write(sandbox.join("plugins/community.ana.verbes/language.json"), LANGUAGE.replace("ouvre", "ferme")).unwrap();
    assert_eq!(store.list().unwrap()[0].state, State::Modified);
    assert!(store.packs().unwrap().is_empty());

    store.remove("community.ana.verbes").unwrap();
    assert!(store.list().unwrap().is_empty());
    assert!(!sandbox.join("plugins/community.ana.verbes").exists());
    let _ = fs::remove_dir_all(sandbox);
}

#[test]
fn installation_requires_the_digest_the_user_approved() {
    let sandbox = scratch("digest");
    let store = Store::new(sandbox.join("plugins")).unwrap();
    let prepared = store.prepare_folder(&plugin_folder(&sandbox, LANGUAGE)).unwrap();
    let error = store.install(&prepared.staging_id, "sha256:0000").unwrap_err();
    assert!(matches!(error, AdapterError::PluginInvalid(ref message) if message.contains("changé")));
    // Après un refus, le plugin préparé reste en transit et peut être réexaminé.
    assert_eq!(store.staged(&prepared.staging_id).unwrap().digest, prepared.digest);
    let _ = fs::remove_dir_all(sandbox);
}

#[test]
fn an_invalid_pack_never_reaches_the_staging_area() {
    let sandbox = scratch("invalid");
    let store = Store::new(sandbox.join("plugins")).unwrap();
    let error = store.prepare_folder(&plugin_folder(&sandbox, r#"{"locale":"fr","phrases":{"openVerbs":["OUVRE.*"]}}"#)).unwrap_err();
    assert!(matches!(error, AdapterError::PluginInvalid(_)));
    let staging = sandbox.join("plugins/.staging");
    assert!(!staging.exists() || fs::read_dir(&staging).unwrap().next().is_none());
    let _ = fs::remove_dir_all(sandbox);
}

#[test]
fn identifiers_coming_from_the_interface_cannot_escape_the_store() {
    let sandbox = scratch("traversal");
    let store = Store::new(sandbox.join("plugins")).unwrap();
    assert!(matches!(store.staged("../../etc"), Err(AdapterError::InvalidTarget(_))));
    assert!(matches!(store.remove("../community.ana.verbes"), Err(AdapterError::InvalidTarget(_))));
    assert!(matches!(store.remove("community.ana.absent"), Err(AdapterError::InvalidTarget(_))));
    let _ = fs::remove_dir_all(sandbox);
}

#[test]
fn only_https_sources_are_fetched_from_the_network() {
    let store = Store::new(scratch("https").join("plugins")).unwrap();
    assert!(matches!(store.prepare_git("http://example.org/a/b.git"), Err(AdapterError::InvalidTarget(_))));
    assert!(matches!(store.prepare_git("https://user:pass@example.org/a/b.git"), Err(AdapterError::InvalidTarget(_))));
}

fn git_available() -> bool {
    Command::new("git").arg("--version").output().map(|out| out.status.success()).unwrap_or(false)
}

#[test]
fn a_git_repository_is_cloned_pinned_to_its_commit_and_checked() {
    if !git_available() {
        eprintln!("git absent : test ignoré");
        return;
    }
    let sandbox = scratch("git");
    let repo = sandbox.join("repo");
    fs::create_dir_all(&repo).unwrap();
    fs::write(repo.join("nexus.json"), MANIFEST).unwrap();
    fs::write(repo.join("language.json"), LANGUAGE).unwrap();
    let git = |args: &[&str]| {
        let status = Command::new("git")
            .arg("-C")
            .arg(&repo)
            .args(["-c", "user.email=test@example.org", "-c", "user.name=test"])
            .args(args)
            .output()
            .unwrap();
        assert!(status.status.success(), "git {args:?} a échoué");
    };
    git(&["init", "-q"]);
    git(&["add", "."]);
    git(&["commit", "-q", "-m", "premier"]);

    let target = sandbox.join("clone");
    let commit = store::clone_repository(repo.to_str().unwrap(), &target).unwrap();
    assert_eq!(commit.len(), 40);
    let _ = fs::remove_dir_all(sandbox);
}

fn example_dir() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR")).join("../examples/plugins/community.exemple.convertisseur")
}

#[test]
fn the_rust_example_runs_its_commands_inside_the_approved_permissions() {
    let sandbox = scratch("wasm");
    let store = Store::new(sandbox.join("plugins")).unwrap();
    let id = "community.exemple.convertisseur";

    let prepared = store.prepare_folder(&example_dir()).unwrap();
    assert_eq!(prepared.permissions.len(), 1);
    assert_eq!(prepared.commands, vec!["convertit", "memorise", "rappelle"]);
    let installed = store.install(&prepared.staging_id, &prepared.digest).unwrap();
    assert_eq!(installed.state, State::Active, "{:?}", installed.problems);

    let packs = store.packs().unwrap();
    assert_eq!(packs[0].actions.len(), 3);

    let converted = store.run_action(id, "convertit", "12 km en miles").unwrap();
    assert_eq!(converted.caption, "12,00 km = 7,46 mi");

    assert_eq!(store.run_action(id, "memorise", "acheter du pain").unwrap().caption, "Noté.");
    assert_eq!(store.run_action(id, "rappelle", "").unwrap().caption, "Tu as noté : acheter du pain");
    assert!(sandbox.join("plugins/data").join(id).join("note.txt").exists(), "le stockage reste dans le dossier du plugin");

    // Une commande non déclarée n'est jamais exécutée.
    assert!(matches!(store.run_action(id, "supprime-tout", ""), Err(AdapterError::InvalidTarget(_))));

    // Permissions retirées du lock : le module est exécuté, mais son stockage est refusé à l'exécution.
    let mut lock = store.read_lock().unwrap();
    lock.plugins.get_mut(id).unwrap().permissions.clear();
    fs::write(sandbox.join("plugins/plugins.lock.json"), serde_json::to_string(&lock).unwrap()).unwrap();
    let refused = store.run_action(id, "memorise", "x").unwrap();
    assert!(refused.caption.contains("permission-refused"), "{}", refused.caption);

    // Supprimer le plugin supprime aussi ses données.
    store.remove(id).unwrap();
    assert!(!sandbox.join("plugins").join("data").join(id).exists());
    let _ = fs::remove_dir_all(sandbox);
}

#[test]
fn a_modified_wasm_module_is_not_run() {
    let sandbox = scratch("wasm-modified");
    let store = Store::new(sandbox.join("plugins")).unwrap();
    let id = "community.exemple.convertisseur";
    let prepared = store.prepare_folder(&example_dir()).unwrap();
    store.install(&prepared.staging_id, &prepared.digest).unwrap();
    let module = sandbox.join("plugins").join(id).join("plugin.wasm");
    let mut bytes = fs::read(&module).unwrap();
    bytes.push(0);
    fs::write(&module, bytes).unwrap();
    assert!(store.run_action(id, "convertit", "1 km en miles").is_err());
    let _ = fs::remove_dir_all(sandbox);
}
