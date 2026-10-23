# SDK NEXUS pour plugins WebAssembly (Rust)

Écrire un plugin NEXUS en Rust, compilé pour `wasm32-unknown-unknown`.

```rust
use nexus_plugin_sdk::{export_commands, host, Input, Output};

fn memorise(input: Input) -> Result<Output, String> {
    host::storage_set("note", input.text.trim())?;   // permission storage.local
    Ok(Output::text("Noté."))
}

export_commands! {
    "memorise" => memorise,
}
```

Dans `nexus.json`, déclarer les commandes, les permissions (avec leur raison) et `plugin.wasm` comme point d'entrée
(voir `examples/plugins/community.exemple.convertisseur`).

Compiler :

    rustup target add wasm32-unknown-unknown
    cargo build --release --target wasm32-unknown-unknown
    cp target/wasm32-unknown-unknown/release/<nom>.wasm plugin.wasm

Valider avant d'installer :

    cargo run --manifest-path src-tauri/Cargo.toml --bin nexus-plugin -- validate <dossier du plugin>

Fonctions hôte : `host::log`, `host::storage_get` / `host::storage_set` (`storage.local`), `host::fetch` (`network.fetch`,
hôtes HTTPS déclarés, sans redirection). Chaque appel refusé renvoie une erreur lisible : le plugin doit la gérer.

Limites : 32 Mo de mémoire, 10 secondes par appel, 256 Ko par message.
