# Serveur de voix (Chatterbox Multilingue) pour un PC avec carte NVIDIA.
# Les bibliothèques CUDA arrivent avec PyTorch : il suffit du pilote NVIDIA
# sur Windows et de Docker Desktop (WSL 2).
FROM python:3.11-slim

ENV PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    HF_HOME=/cache/huggingface \
    PC_TTS_VOICES=/voix

# ffmpeg : pour lire des voix de référence en mp3 / m4a (enregistrement du téléphone, LibriVox).
RUN apt-get update && apt-get install -y --no-install-recommends libsndfile1 libgomp1 ffmpeg git && rm -rf /var/lib/apt/lists/*

WORKDIR /app
# Par défaut, la version du dépôt officiel (modèle multilingue v3, meilleur en français).
# Si la construction échoue un jour : docker compose build --build-arg CHATTERBOX_SOURCE=chatterbox-tts==0.1.7
ARG CHATTERBOX_SOURCE=git+https://github.com/resemble-ai/chatterbox.git
RUN pip install --upgrade pip && pip install "${CHATTERBOX_SOURCE}" fastapi "uvicorn[standard]" soundfile

COPY server.py /app/server.py

EXPOSE 8765
CMD ["uvicorn", "server:app", "--host", "0.0.0.0", "--port", "8765"]
