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
# 1) La version publiée (connue pour s'installer sans surprise) et toutes ses dépendances.
RUN pip install --upgrade pip && pip install "chatterbox-tts==0.1.7" fastapi "uvicorn[standard]" soundfile python-multipart faster-whisper anthropic silero-vad
# 2) Le code plus récent du dépôt officiel (modèle multilingue v3, meilleur en français) par-dessus,
#    sans toucher aux dépendances. Si ça ne s'importe pas, on revient à la version publiée :
#    la construction n'échoue jamais pour ça.
RUN (pip install --no-deps "git+https://github.com/resemble-ai/chatterbox.git" \
      && python -c "from chatterbox.mtl_tts import ChatterboxMultilingualTTS; print('chatterbox récent OK')") \
    || (echo "Version récente indisponible, retour à chatterbox-tts 0.1.7" && pip install --force-reinstall --no-deps "chatterbox-tts==0.1.7")

COPY server.py /app/server.py
COPY entrypoint.sh /app/entrypoint.sh
RUN chmod +x /app/entrypoint.sh

EXPOSE 8765
CMD ["/app/entrypoint.sh"]
