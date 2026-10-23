# Verbes supplémentaires

Exemple de paquet de données pour NEXUS. Il ne contient aucun code.

- `language.json` : verbes d'ouverture supplémentaires et mots de remplissage.
- `aliases.json` : noms alternatifs pour une application du catalogue (ici Discord).

Valider le paquet :

    cargo run --manifest-path src-tauri/Cargo.toml --bin nexus-plugin -- validate examples/plugins/community.exemple.verbes

Installer le paquet depuis le dossier local (dans NEXUS) : « installe le plugin <chemin absolu du dossier> ».
