#!/usr/bin/env bash
# Prepare local speech (Parakeet STT, Kokoro TTS) to run on an NVIDIA GPU.
# See the local-speech-gpu entry in custom/CHANGES.md.
#
# Everything lands in user directories: no sudo, no driver or system package changes.
#   $CUDA_ROOT/venv   pip wheels with the CUDA 12 runtime and cuDNN 9 (~2.7 GB)
#   $CUDA_ROOT/lib    the directory PASEO_LOCAL_SPEECH_CUDA_DIR points at: symlinks to
#                     those libraries plus sherpa-onnx's CUDA build matching the
#                     sherpa-onnx-node version this checkout uses
#   <home>/models/local-speech/sherpa-onnx-nemo-parakeet-tdt-0.6b-v2-fp16
#                     the fp16 model plus encoder.fp16-cuda.onnx (patched for CUDA)
#
# Usage: custom/local-speech-gpu/setup.sh [paseo-home ...]   (default: ~/.paseo)
# Rerun it whenever upstream bumps sherpa-onnx-node; it is idempotent.
set -euo pipefail

ROOT="$(git -C "$(dirname "${BASH_SOURCE[0]}")" rev-parse --show-toplevel)"
CUDA_ROOT="${PASEO_CUDA_ROOT:-$HOME/.local/share/paseo-cuda}"
HOMES=("$@")
[[ ${#HOMES[@]} -gt 0 ]] || HOMES=("$HOME/.paseo")

SHERPA_VERSION="$(node -p "require('$ROOT/node_modules/sherpa-onnx-linux-x64/package.json').version")"
MODEL_URL="https://github.com/k2-fsa/sherpa-onnx/releases/download/asr-models/sherpa-onnx-nemo-parakeet-tdt-0.6b-v2-fp16.tar.bz2"
MODEL_DIR_NAME="sherpa-onnx-nemo-parakeet-tdt-0.6b-v2-fp16"

echo "==> CUDA 12 runtime and cuDNN 9 wheels in $CUDA_ROOT/venv"
mkdir -p "$CUDA_ROOT/lib"
if [[ ! -x "$CUDA_ROOT/venv/bin/python" ]]; then
  if command -v uv >/dev/null; then uv venv -q "$CUDA_ROOT/venv"; else python3 -m venv "$CUDA_ROOT/venv"; fi
fi
PIP=(uv pip install -q --python "$CUDA_ROOT/venv/bin/python")
command -v uv >/dev/null || PIP=("$CUDA_ROOT/venv/bin/pip" install -q)
"${PIP[@]}" nvidia-cuda-runtime-cu12 nvidia-cublas-cu12 nvidia-cufft-cu12 nvidia-curand-cu12 \
  "nvidia-cudnn-cu12>=9,<10" onnx numpy
for lib in "$CUDA_ROOT"/venv/lib/python3*/site-packages/nvidia/*/lib/*.so*; do
  ln -sf "$lib" "$CUDA_ROOT/lib/"
done

if [[ "$(cat "$CUDA_ROOT/lib/SHERPA_VERSION" 2>/dev/null)" != "$SHERPA_VERSION" ]]; then
  echo "==> sherpa-onnx $SHERPA_VERSION CUDA build"
  tmp="$(mktemp -d)"
  trap 'rm -rf "$tmp"' EXIT
  name="sherpa-onnx-v$SHERPA_VERSION-cuda-12.x-cudnn-9.x-linux-x64-gpu"
  curl -fL --progress-bar -o "$tmp/gpu.tar.bz2" \
    "https://github.com/k2-fsa/sherpa-onnx/releases/download/v$SHERPA_VERSION/$name.tar.bz2"
  tar -xjf "$tmp/gpu.tar.bz2" -C "$tmp"
  for lib in libsherpa-onnx-c-api.so libonnxruntime.so libonnxruntime_providers_cuda.so \
    libonnxruntime_providers_shared.so; do
    cp "$tmp/$name/lib/$lib" "$CUDA_ROOT/lib/"
  done
  echo "$SHERPA_VERSION" >"$CUDA_ROOT/lib/SHERPA_VERSION"
fi

for home in "${HOMES[@]}"; do
  models="$home/models/local-speech"
  dir="$models/$MODEL_DIR_NAME"
  if [[ ! -f "$dir/encoder.fp16.onnx" ]]; then
    echo "==> Parakeet fp16 into $models"
    mkdir -p "$models"
    curl -fL --progress-bar "$MODEL_URL" | tar -xj -C "$models"
  fi
  if [[ ! -f "$dir/encoder.fp16-cuda.onnx" ]]; then
    echo "==> Patching the encoder for CUDA"
    "$CUDA_ROOT/venv/bin/python" -I "$ROOT/custom/local-speech-gpu/patch-parakeet-encoder-for-cuda.py" \
      "$dir/encoder.fp16.onnx" "$dir/encoder.fp16-cuda.onnx.tmp"
    mv "$dir/encoder.fp16-cuda.onnx.tmp" "$dir/encoder.fp16-cuda.onnx"
  fi
done

cat <<EOF

Done. Add these to the env of each Paseo launcher (Exec=env ... in ~/.local/share/applications/paseo*.desktop):
  PASEO_LOCAL_SPEECH_CUDA_DIR=$CUDA_ROOT/lib
  PASEO_DICTATION_LOCAL_STT_MODEL=parakeet-tdt-0.6b-v2-fp16
  PASEO_VOICE_LOCAL_STT_MODEL=parakeet-tdt-0.6b-v2-fp16
EOF
