# Audios de test (parole synthétique)

Fichiers WAV 16 kHz, mono, PCM 16 bits, générés avec espeak-ng (outil de test, non distribué avec NEXUS) :

```bash
espeak-ng -v fr -s 150 -w raw.wav "Lance Discord"
ffmpeg -f lavfi -t 0.8 -i anullsrc=r=16000:cl=mono -i raw.wav -f lavfi -t 0.8 -i anullsrc=r=16000:cl=mono \
  -filter_complex "[0][1][2]concat=n=3:v=0:a=1,aresample=16000" -ac 1 -ar 16000 -c:a pcm_s16le fr-lance-discord.wav
```

Chaque fichier contient 0,8 s de silence, la phrase, puis 0,8 s de silence. Les tests vérifient que le VAD
détecte la parole entre 700 et 900 ms, en cohérence avec la référence onnxruntime.

Ces audios sont synthétiques. Ils ne représentent ni un micro réel, ni des accents, ni du bruit.
