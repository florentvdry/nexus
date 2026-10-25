# Architecture de NEXUS

NEXUS suit un principe : l'utilisateur formule une intention, le système choisit les outils.
Chaque demande est comprise par un modèle de langage local (Ollama) dont la réponse est validée avant usage.
L'analyseur de texte par règles a été retiré (ADR-029) : il ne reste aucune règle de texte pour comprendre une phrase.

## Vue d'ensemble

```
┌──────────────────────── Application frontend (React + TypeScript) ────────────────────────┐
│ Orbe · zone des tâches · fenêtres flottantes · barre de commande · historique · réglages │
│ src/ui/*  — ne contient aucune logique métier                                           │
└───────────────┬───────────────────────────────────────────▲───────────────────────────────┘
                │ commandes texte ou voix                    │ événements (message, orbe,
                ▼                                           │ tâche, fenêtre à présenter)
┌──────────────────────── Core Engine (TypeScript pur, testable sans interface) ──────────┐
│ language-model/ compréhension par le modèle local, réponse validée (validate.ts)         │
│ engine/      routage : intention → capacité, orchestration, orbe, messages              │
│ capabilities/ registre : permissions, délais, annulation, isolation des erreurs          │
│ tasks/       file de tâches avec états réels (en attente, en cours, terminée, …)         │
│ presentation/ placement spatial des fenêtres, dimensionnement, historique                │
│ schedule/, alerts/, voice/, web/, osint/, memory/, conversation/ …                       │
└───────────────┬───────────────────────────────────────────────────────────────────────────┘
                │ NativeAdapter (contrat typé, src/core/native/adapter.ts)
                ▼
┌──────────────────────── Adaptateur Windows (Rust, Tauri 2) — src-tauri/src ──────────────┐
│ lib.rs          commandes Tauri exposées au frontend, identité de l'appelant             │
│ plugins/        code natif des plugins : système, applications (scan du PC), fichiers,    │
│                 processus, fenêtres, OSINT, voix (whisper, capture micro)                 │
│ ollama.rs       modèle local via Ollama (127.0.0.1) : compréhension et vision             │
│ nim.rs          NVIDIA NIM, option désactivée par défaut, avec la clé de l'utilisateur    │
│ web.rs          questions ouvertes, actualités, photos et fiches (sources publiques)      │
│ screen.rs       capture d'écran de l'écran principal, après confirmation                  │
│ voice_tts.rs    voix neurale locale (Piper), téléchargée après accord                     │
│ permissions.rs  confirmations natives · grants.rs : table des permissions par appelant    │
│ memory.rs · schedule.rs · agenda.rs · power.rs · startup.rs · journal.rs · mcp/           │
└──────────────────────────────────────────────────────────────────────────────────────────┘
```

Règle de frontières : le frontend ne voit jamais de commande shell. Le core ne connaît que le
contrat `NativeAdapter`. Le backend Rust ne reçoit qu'un nom : il le cherche sur le PC, et ne lance que ce qu'il a trouvé.

## Flux d'une commande

1. `CommandBar` (ou le pipeline vocal) envoie le texte à `Engine.submit`.
2. `understandWithModel` (`src/core/language-model/branch.ts`) envoie la demande au modèle local, avec les souvenirs, la
   conversation récente et les commandes des plugins installés, comme données. La réponse est contrainte par un schéma
   puis validée (`validate.ts`) : une intention connue, ou `UNKNOWN`. Sans modèle prêt, rien n'est deviné : l'interface
   le dit à l'utilisateur.
3. Le routeur (`engine.ts`) choisit la capacité (`apps.launch`, `system.info`, …) ou une action de contrôle
   (fermer une fenêtre, annuler des tâches, programmer une demande, aide).
4. La capacité passe par `CapabilityRegistry.invoke` : permissions vérifiées, délai appliqué,
   annulation transmise, erreurs converties en `CapabilityError`.
5. Le `TaskManager` expose l'état réel de la tâche : `pending` tant que la file est saturée,
   `running` pendant l'appel natif, puis `done`, `error` ou `cancelled`.
6. Le résultat devient une réponse courte (sous l'orbe) et, si besoin, des `PresentedContent`.
7. Le moteur de placement choisit un emplacement libre pour chaque fenêtre.

Les actions sensibles (écriture de fichier, suppression, lancement de Claude Code) passent en plus par une confirmation
**dans le backend Rust** (`permissions::confirm`), pas seulement dans l'interface.

## Pipeline vocal

```
Micro (cpal) ──► 16 kHz mono ──► Silero VAD (tract) ──► Segmenter ──► whisper.cpp (whisper-rs)
   plugins/speech/capture.rs     vad.rs                segmenter.rs      transcribe.rs
                                                              │
                                 événements `voice://event` ◄─┘ (plugins/speech/session.rs)
                                                              ▼
Frontend : VoiceController ──► Engine.submit(texte, langue de réponse) ──► réponse
                 │                                                          │
                 └── lecture à voix haute : Piper (voice_tts.rs) si la voix est installée, ◄┘
                     sinon voix système (API Web Speech)
```

- Le micro n'est ouvert que pendant une session demandée (bouton, raccourci `Ctrl+Alt+Espace`).
- Le VAD découpe la parole. Whisper ne reçoit que des énoncés complets, avec 300 ms de silence avant le début.
- Les événements `listening`, `speech-started`, `transcribing`, `transcript`, `error`, `stopped` pilotent l'orbe et la barre de commande.
- `VoiceController` (`src/core/voice/controller.ts`) ne connaît ni Tauri ni le DOM. Ses dépendances (entrée, sortie, moteur) sont injectées ; les tests utilisent des doubles nommés.
- Synthèse : `NeuralSpeechOutput` (`src/core/voice/neural-output.ts`) joue le WAV produit par Piper avec Web Audio.
  Le chemin du moteur et de la voix est fixe côté Rust : l'interface ne transmet que le texte et la vitesse.
  Sans voix installée pour la langue de la réponse, la voix système lit la réponse.
- Langue : Whisper détecte la langue de la voix ; un comptage de mots fréquents sert au texte. Le réglage « automatique » répond dans la langue détectée, les réglages « français » ou « anglais » l'imposent.
- Les modèles de reconnaissance et de synthèse ne sont jamais téléchargés sans accord. Whisper (`ggml-base.bin`) se place à la main, à l'emplacement `%APPDATA%\fr.nexus.assistant\models\`, ou à celui de `NEXUS_WHISPER_MODEL`. La voix Piper s'installe depuis les réglages vocaux, sur clic.

## Connecteurs OSINT et isolation

```
Frontend : osint.domain / osint.username / document.inspect (capacités, permissions, délais)
     │  invoke("osint_run", { request })
     ▼
Backend : osint_run ──► liste fermée CONNECTORS ──► spawn `nexus-worker` (processus séparé)
                                                        │ requête JSON sur stdin
                                                        ▼
                                          plugins::run_connector ──► sources (dns, certificates, usernames) | documents
                                                        │ rapport JSON sur stdout (4 Mo max)
     ◄──────────── rapport normalisé (findings, errors, partial) ◄──┘
Délai dépassé : le worker est arrêté (kill). Sortie invalide ou code d'erreur : erreur explicite.
```

- Le worker ne reçoit que la requête. Il n'a accès ni à l'état de l'application ni à l'interface.
- Chaque résultat garde sa source (nom, URL), sa date de collecte et un statut. Les sources ne sont jamais fusionnées :
  deux profils au même pseudo restent deux résultats distincts, sans attribution.
- Les limites de lecture (un 404 n'est pas une absence) sont affichées avec les résultats.

## Niveaux de compréhension et de coût

| Mécanisme | État |
|---|---|
| Règles de texte (expressions régulières, dictionnaires) | Retirées pour la compréhension (ADR-029) |
| Modèle de langage local via Ollama (Qwen2.5 1,5 B, 7 B ou 14 B selon la machine) | Implémenté, seul chemin de compréhension (ADR-026, ADR-029) |
| Fournisseur externe optionnel (NVIDIA NIM, avec clé de l'utilisateur) | Implémenté, désactivé par défaut (ADR-040) |

Coût des capacités (champ `cost` du manifeste) : `local`, `internet`, `external-api`, `llm`.

## Capacités et plugins

La convention complète (dossiers par type, fiche `plugin.json`, cycle de vie) est dans [PLUGINS.md](PLUGINS.md).

Chaque capacité déclare un `CapabilityManifest` : identifiant (`domaine.action`), version
sémantique, description, catégories, entrées et sorties, dépendances, permissions requises,
localité (`local` ou `network`), API requises, délai maximal, coût, disponibilité hors ligne.

Les entrées sont sérialisables (`Record<string, string>`) : c'est la frontière qui permet de déplacer les plugins dans des
processus isolés sans changer leur contrat.

Les capacités intégrées (dans `plugins/`) s'exécutent dans le processus de l'application. Le registre garantit
qu'une erreur ou un dépassement de délai ne fait pas tomber l'application. Les plugins WebAssembly tournent dans un
bac à sable (wasmtime), avec les seules permissions approuvées à l'installation.

## Placement spatial des fenêtres

`src/core/presentation/placement.ts` est une fonction pure :

- Zones interdites : marges d'écran, zones HUD (`[data-hud]`), cercle d'exclusion de l'orbe
  (rayon de l'orbe + espace), fenêtres existantes (avec espacement).
- Candidats : grille de points sur l'écran, essai en taille complète puis réduite (85 %, 70 %).
- Score : distance à un anneau autour de l'orbe, et éloignement des autres fenêtres pour ne pas
  les empiler au même endroit. Le meilleur score gagne.
- Si l'écran est saturé, la fenêtre la plus ancienne est déplacée dans l'historique
  (`evicted`) pour laisser place au résultat le plus récent.
- Au redimensionnement, `reflowWindows` conserve les fenêtres encore valides et replace les autres.

Le DOM n'est lu que par `src/ui/scene.ts`. Le moteur reste testable sans navigateur.

## Données et état

- En mémoire, pour la session : transcription, tâches, fenêtres, historique borné à 20 entrées. La conversation n'est pas conservée au redémarrage (choix de confidentialité).
- Dans le dossier de données de l'application (`%APPDATA%\fr.nexus.assistant\`), sur ce PC et sans envoi réseau :
  - `memory/memories.json` : souvenirs de l'utilisateur, sans limite de nombre ;
  - `schedule/tasks.json` : tâches programmées (100 au plus), écriture atomique ;
  - `permission_rules.json` : autorisations mémorisées, révocables une à une ;
  - base SQLite du journal des commandes (désactivé par défaut, 500 entrées au plus) ;
  - `mcp/installed.json` : connecteurs MCP installés ; leurs variables sont gardées en clair (chiffrement à faire) ;
  - `voices/` : moteur Piper et voix installées, après accord.
- Dans le stockage local du navigateur : préférence de langue et routines détectées (`nexus.routines.v1`). La clé NVIDIA NIM, si l'option est activée, y est aussi gardée, en clair (à déplacer vers le stockage natif chiffré). Un stockage bloqué désactive simplement la fonctionnalité concernée.

## Multilinguisme

- Interface : `src/i18n/messages.ts`. Le TypeScript impose la parité des clés FR et EN.
- Commandes : elles se formulent en français ou en anglais, sans réglage de langue pour la compréhension.
- Ajouter une langue : un jeu de messages, une voix Piper dans `VOICES` (`voice_tts.rs`) si la synthèse doit être neurale, et les formats `Intl`.

## Limites connues de l'architecture

- Pas d'écoute permanente ni de mot de réveil : seuls la touche, le raccourci et le clic activent le micro.
- Une tâche programmée ne tourne que si NEXUS est ouvert ; une tâche manquée s'exécute une fois à la réouverture.
  Le démarrage avec Windows est une case des réglages (ADR-035).
- Pas encore d'installateur public. Le worker `nexus-worker` doit être déclaré comme binaire externe (`bundle.externalBinaries`) avant tout installateur.
- Le contrôle des fenêtres Windows et le lancement d'applications n'ont pas encore été vérifiés sur une machine Windows
  (voir `docs/TODO.md`, section 5).
- Pas encore de traduction (Argos), ni d'analyse d'adresses email, d'enregistrements MX/TXT/NS ou de métadonnées EXIF : prévus, non livrés.
