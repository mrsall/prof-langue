# Serveur de voix (Chatterbox Multilingue) pour un PC avec carte NVIDIA.
# Les bibliothèques CUDA arrivent avec PyTorch : il suffit du pilote NVIDIA
# sur Windows et de Docker Desktop (WSL 2).
FROM python:3.11-slim

ENV PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    HF_HOME=/cache/huggingface \
    PC_TTS_VOICES=/voix

RUN apt-get update && apt-get install -y --no-install-recommends libsndfile1 libgomp1 && rm -rf /var/lib/apt/lists/*

WORKDIR /app
RUN pip install --upgrade pip && pip install chatterbox-tts fastapi "uvicorn[standard]" soundfile

COPY server.py /app/server.py

EXPOSE 8765
CMD ["uvicorn", "server:app", "--host", "0.0.0.0", "--port", "8765"]
