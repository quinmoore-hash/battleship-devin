# Audio licences

Every file in this directory (`*.ogg`, `*.mp3`) is **generated procedurally** by `scripts/generate-audio.mjs`
(pure Node DSP in `scripts/audio/*.mjs` — oscillators, noise, Karplus–Strong plucks, formant "voices",
comb/all-pass reverb — encoded with ffmpeg). No recorded samples, loops, soundfonts or third-party assets are used.

The generated audio is therefore covered by this repository's licence; there is nothing to attribute.
Regenerate with `node scripts/generate-audio.mjs` (deterministic: seeded RNG, identical output on every run).
