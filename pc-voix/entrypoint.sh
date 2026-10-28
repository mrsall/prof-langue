#!/bin/sh
# Whisper (CTranslate2) a besoin des bibliothèques cuBLAS et cuDNN livrées avec PyTorch : on les rend visibles.
NVLIBS="$(python - <<'EOF'
import importlib, os
paths = []
for name in ("nvidia.cublas.lib", "nvidia.cudnn.lib"):
    try:
        mod = importlib.import_module(name)
        paths.append(os.path.dirname(mod.__file__))
    except Exception:
        pass
print(":".join(paths))
EOF
)"
export LD_LIBRARY_PATH="${NVLIBS}:${LD_LIBRARY_PATH}"
exec uvicorn server:app --host 0.0.0.0 --port 8765
