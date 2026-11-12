#!/usr/bin/env bash
# Normaliza o volume para as redes sociais (-14 LUFS, pico -1 dBTP), sem voltar a codificar a imagem.
set -euo pipefail
in="${1:-out/chordtile-short.mp4}"; out="${2:-out/chordtile-short-final.mp4}"
m=$(ffmpeg -hide_banner -i "$in" -vn -af loudnorm=I=-14:TP=-1:LRA=11:print_format=json -f null - 2>&1 | sed -n '/^{/,/^}/p')
get() { echo "$m" | sed -n "s/.*\"$1\" : \"\([^\"]*\)\".*/\1/p"; }
ffmpeg -hide_banner -v error -y -i "$in" -c:v copy -af "loudnorm=I=-14:TP=-1:LRA=11:measured_I=$(get input_i):measured_TP=$(get input_tp):measured_LRA=$(get input_lra):measured_thresh=$(get input_thresh):offset=$(get target_offset):linear=true" -ar 48000 -c:a aac -b:a 256k -movflags +faststart "$out"
echo "→ $out"
