# Décisions techniques

## ADR-001 — Tauri 2 plutôt qu'Electron

Tauri utilise le WebView2 déjà présent sur Windows 10 et 11 : binaire léger, démarrage rapide,
accès natif en Rust. Le besoin de consommation mémoire réduite (objectif du brief, section 16)
l'emporte sur la familiarité d'Electron.

## ADR-002 — Core Engine en TypeScript pur

La logique de commande, de tâches et de placement ne dépend ni de React ni de Tauri. Elle se teste
en Node sans navigateur. Les contraintes de performance ne justifient pas encore un passage à Rust.

## ADR-003 — Classification par règles en phase 1

Les commandes de la phase 1 sont courtes et bien délimitées. Des expressions régulières et des
dictionnaires suffisent, sans coût ni latence. Un classificateur local viendra en phase 5, si les
règles ne couvrent plus les besoins.

## ADR-004 — Catalogue fermé pour le lancement d'applications

Le frontend envoie un identifiant (`discord`), jamais une commande. Cela évite l'exécution de
commandes arbitraires à partir d'un texte, y compris un texte qui viendrait de sources externes.
Ajouter une application revient à ajouter une entrée dans `apps.rs` et dans `dictionaries.ts`.

## ADR-005 — Aucune donnée simulée en mode navigateur

Hors application de bureau, le backend natif est remplacé par un adaptateur qui échoue
explicitement. Les données de démonstration n'existent que dans les tests, et ils le signalent.

## ADR-006 — Licence MIT

Compatible avec les dépendances actuelles (Tauri, React, sysinfo, Vite, Vitest sont MIT ou
Apache-2.0). Les composants vocaux de la phase 2 devront être vérifiés individuellement.
