# Modèles embarqués

## `silero_vad_16k_openvino.onnx`

- Modèle : Silero VAD v6.2.3, variante `silero_vad_openvino_16k.onnx`, distribuée dans le paquet PyPI officiel `silero-vad` 6.2.3.
- Licence : MIT, texte dans `SILERO-LICENSE.txt`.
- Modifications : les 167 nœuds du graphe ont reçu des noms uniques (15 nœuds portaient le même nom `F0::anon`, ce que tract refuse à la compaction du graphe). Le calcul n'est pas modifié : les probabilités ont été comparées à onnxruntime sur les fichiers de test (`src-tauri/tests/fixtures/voice`).
- Pourquoi cette variante : elle ne contient pas d'opérateur `If` et ne gère que 16 kHz. tract (ONNX en Rust pur) peut donc l'exécuter sans runtime natif supplémentaire.

## Modèle de reconnaissance (non embarqué)

Le modèle Whisper (`ggml-base.bin`, multilingue, environ 148 Mo) n'est pas inclus dans le dépôt ni dans l'installateur. L'utilisateur le place à l'emplacement affiché dans les réglages vocaux. Voir le README principal.
