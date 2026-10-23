# Convertisseur et mémo

Exemple de plugin NEXUS écrit en Rust et compilé en WebAssembly.

Commandes :
- « convertis 12 km en miles », « convertir 100 c en f » : km ↔ mi, kg ↔ lb, °C ↔ °F.
- « retiens acheter du pain » : garde une note (permission `storage.local`, 16 Ko).
- « rappelle » : rappelle la note gardée.

Reconstruire le module :

    rustup target add wasm32-unknown-unknown
    cargo build --release --target wasm32-unknown-unknown
    cp target/wasm32-unknown-unknown/release/community_exemple_convertisseur.wasm plugin.wasm

Installer depuis NEXUS : « installe le plugin <chemin absolu de ce dossier> ». Les dossiers `target/` et `.git/` à la
racine ne sont pas copiés.
