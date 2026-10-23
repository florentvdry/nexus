# Politique de sécurité

## Versions prises en charge

Seule la branche principale reçoit les corrections de sécurité, pendant la phase de développement.

## Signaler une vulnérabilité

Ne publiez pas de détails dans une issue publique. Utilisez le signalement privé de GitHub
(onglet « Security », puis « Report a vulnerability ») sur le dépôt du projet.

Indiquez : la version, les étapes pour reproduire, l'impact estimé et, si possible, un correctif.
Nous accusons réception dans un délai raisonnable et publions un avis une fois le correctif disponible.

## Périmètre

Sont dans le périmètre : l'exécution de commandes non prévues, les élévations de privilèges, la
fuite de données personnelles, le contournement des permissions de `docs/PERMISSIONS.md`.

Hors périmètre : les vulnérabilités des applications lancées par NEXUS, et des bibliothèques
tierces qui n'ont pas d'impact démontré sur NEXUS (à signaler à leurs auteurs).
