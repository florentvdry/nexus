# Analyse des causes : pourquoi NEXUS se trompe, et comment l'éviter

Ce document relie chaque défaut signalé pendant les tests à sa cause de fond, à la correction faite, et au contrôle qui doit
empêcher le retour du défaut. Il ne remplace pas les tests : il dit quels tests manquaient.

## Les causes de fond, en une phrase chacune

1. **Le schéma de réponse du modèle est plus strict que ce que produisent les petits modèles.** Le modèle 1,5 B ou 7 B renvoie
   parfois le champ au mauvais nom (`query` au lieu de `request`, `question` au lieu de `text`). La validation rejetait alors la
   réponse entière, et NEXUS répondait « je n'ai pas compris ».
2. **Une règle générale du prompt s'applique à des cas qu'elle ne visait pas.** « Lance » était associé aux lancements d'agents
   (Claude Code), donc « lance Edge » devenait `AGENT_RUN`.
3. **Le catalogue d'applications est écrit à deux endroits** (TypeScript pour les alias, Rust pour les chemins). Une application
   ajoutée d'un seul côté n'est pas trouvée.
4. **Un réglage est mal nommé par rapport à son effet.** Le bouton « Répondre à voix haute » écrivait le mode `voice`, qui ne lit
   que les commandes vocales : tapé au clavier, rien n'était lu.
5. **Les sources étaient fermées par conception.** Wikipédia, Commons et Google Actualités ne répondent pas à une question
   ouverte (« tu connais GTA RP ? »). L'erreur « aucune page trouvée » venait de là, pas d'un bogue.
6. **Le modèle ne voyait que la demande courante.** Sans l'échange précédent, « elle », « ça » et « la suite » étaient incompris.
7. **Les textes d'erreur sont génériques.** « L'opération a échoué » ne dit pas quelle source a échoué, ce qui rend le défaut
   difficile à reproduire.
8. **Des noms de dossiers ou d'applications en français n'étaient connus que d'un côté.** Le Rust refusait « bureau ».

## Tableau des défauts

| Défaut signalé | Cause de fond | Correction | Contrôle pour éviter le retour |
|---|---|---|---|
| « Lance Edge » : application inconnue | Edge absent du catalogue ; règle « lance » trop large (5, 2) | Edge ajouté (Rust + TypeScript + traductions) ; règle « lance X = ouverture d'application » dans le prompt | Test Rust `finds_edge_in_program_files_x86` ; à ajouter : test de routage « lance X » dans `benchmark.ts` |
| « L'opération a échoué » sur Britney Spears | Non reproduit : la requête directe et l'application renvoient la même page (1, 7) | Aucune correction de code à ce stade | Afficher le détail de la source dans l'erreur ; à faire : recherche de titre quand la page directe n'existe pas |
| Planning : une simple liste dans une fenêtre | Choix initial : la liste était une « fenêtre de données » (7) | Panneau Planning avec annulation par tâche | Tests `SchedulePanel.test.tsx` et `removeById` |
| Pas de réponse vocale au clavier | Mode `voice` confondu avec « toujours » (4) | Le bouton active le mode `always` | Essai en application : le texte est bien lu (speechSynthesis) |
| « Ça famille tient des commerces ? » mal compris | Pas de contexte, et pas de source ouverte (5, 6) | Historique donné au modèle ; questions ouvertes sur le web (ASK_WEB) | Tests `history.test.ts`, `web-ask.test.ts`, `ask.test.ts` |
| « Tu connais GTA RP ? » sans réponse | Pas de recherche générale (5) | Recherche DuckDuckGo sans clé, lecture bornée des pages, réponse citant ses sources | Tests Rust `search_results_are_read…`, `only_public_web_addresses…` ; essai en application |
| « Trouve-moi une photo de Britney Spears » | Non reproduit : testé dans l'application, la photo s'affiche avec son auteur et sa licence | Aucune | Même contrôle que la ligne précédente |
| « Salut » pris pour le prénom | Pas de validation des réponses du premier lancement (1) | Refus des salutations et nouvelle question | Tests `firstConversation` |
| Dossier « bureau » refusé | Alias français absents du Rust (8) | `folder_alias()` | Test `french_folder_names_resolve…` |
| Vision : description inventée | Modèle 3 B trop petit (limite de modèle) | Plus grand modèle de vision installé ; description marquée comme à vérifier | Test manuel sur capture réelle ; pas de test automatique fiable |
| Texte des news qui déborde | URL longues sans retour à la ligne | `overflow-wrap`, URL non affichée | Test d'interface |

## Ce qui manque encore pour éviter les retours

- **Un banc de tests de compréhension** : une liste de phrases réelles (dont celles signalées) avec la commande attendue, rejouée
  sur chaque modèle installé. `src/core/language-model/benchmark.ts` existe ; il faut y ajouter les cas « lance X », « tu connais X »,
  « elle », « ça ». Ce banc doit tourner sur le modèle réel, pas seulement sur des réponses simulées.
- **Des messages d'erreur qui nomment la source** (Wikipédia, DuckDuckGo, page lue), avec le détail technique dans le journal.
- **Une vérification de cohérence du catalogue** : un test qui échoue si une application présente dans TypeScript n'a pas d'entrée
  Rust correspondante (et inversement).
- **Un contrôle des sources web** : les résultats de DuckDuckGo incluent des sites commerciaux peu fiables. Le modèle répond à
  partir d'eux sans les classer. À faire : préférer les sites officiels et Wikipédia, et dire quand la source est un site commercial.

## Limites connues, à ne pas oublier

- La reconnaissance vocale (Whisper) nécessite le fichier de modèle, absent sur ce poste. La saisie vocale ne fonctionne pas tant
  que ce fichier n'est pas fourni.
- La vérification d'adresse (`public_url`) porte sur l'adresse écrite. Un nom de domaine qui pointe vers une adresse privée n'est
  pas détecté, et une redirection vers une adresse privée n'est pas bloquée. Pour une protection complète, il faudra résoudre le nom
  avant la requête.
- « Lance Edge » n'a pas été testé dans l'application en fonctionnement, pour ne pas ouvrir Edge sur ce poste sans demande.
