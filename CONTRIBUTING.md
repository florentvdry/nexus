# Contribuer à NEXUS

Merci de votre intérêt. Quelques règles pour garder le projet stable et compréhensible.

## Principes

1. **Pas de données simulées présentées comme réelles.** Une simulation doit être explicitement
   nommée comme telle, et réservée aux tests.
2. **Pas de logique métier dans l'interface.** Les composants de `src/ui` appellent le moteur.
3. **Pas de commande libre.** Le lancement passe par le catalogue fermé (`src-tauri/src/apps.rs`).
4. **Pas d'appel à un modèle de langage pour une tâche simple.** Ajoutez d'abord une règle locale.
5. **Chaque capacité déclare son manifeste** : permissions, localité, délai, coût.
6. **Les erreurs ne sont jamais masquées.** Elles apparaissent sous forme de carte d'erreur.

## Mise en place

```bash
pnpm install
pnpm test && pnpm typecheck
cd src-tauri && cargo test && cargo clippy --all-targets -- -D warnings
```

## Ajouter une application lançable

1. Ajouter une entrée `AppSpec` dans `src-tauri/src/apps.rs` avec ses emplacements candidats.
2. Ajouter une entrée `AppEntry` dans `src/core/intent/dictionaries.ts` (alias FR et EN).
3. Ajouter le nom traduit dans `src/i18n/messages.ts` (clé `app.*`, FR et EN).
4. Ajouter un test dans `parse.test.ts`.

## Ajouter une capacité

Voir `src/core/capabilities/builtin/apps.ts` comme modèle. Le manifeste est obligatoire et validé
à l'enregistrement. Les entrées doivent rester sérialisables.

## Messages de commit

Format court et descriptif, en français ou en anglais : `feat:`, `fix:`, `docs:`, `test:`, `ci:`.
