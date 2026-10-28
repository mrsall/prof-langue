"""
Serveur de voix pour le PC de Cherif (carte NVIDIA) : fabrique l'audio d'une
phrase avec Chatterbox Multilingue (libre, licence MIT), en français et en
anglais, et le renvoie en WAV. L'app sur Vercel l'appelle à travers un tunnel
Tailscale, avec un mot de passe partagé (PC_TTS_TOKEN).

  GET  /health                       → { ok, model, device, voices, warm }
  POST /tts  { text, language, voice } → audio/wav   (Authorization: Bearer <PC_TTS_TOKEN>)

Les voix : un fichier WAV de 6 à 15 s dans le dossier ./voix, nommé d'après le
personnage (ami.wav, grand-frere.wav, debatteur.wav, prof.wav, collegue.wav,
situation.wav, juge.wav). Variante par langue possible : prof.en.wav. Sans
fichier, la voix par défaut du modèle est utilisée.
"""
import asyncio
import io
import logging
import os
import time
from pathlib import Path

import soundfile as sf
import torch
from fastapi import Depends, FastAPI, Header, HTTPException
from fastapi.responses import JSONResponse, Response
from pydantic import BaseModel
from starlette.concurrency import run_in_threadpool

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
log = logging.getLogger("pc-voix")

TOKEN = os.environ.get("PC_TTS_TOKEN", "").strip()
VOICES_DIR = Path(os.environ.get("PC_TTS_VOICES", "/voix"))
T3 = os.environ.get("CHATTERBOX_T3", "v3").strip() or None
DEVICE = "cuda" if torch.cuda.is_available() else "cpu"
LANGUAGES = {"fr", "en"}
MAX_CHARS = 600

app = FastAPI(title="prof-langue · voix du PC")
state = {"model": None, "warm": False, "model_name": None, "error": None}
gpu_lock = asyncio.Lock()


def load_model():
    from chatterbox.mtl_tts import ChatterboxMultilingualTTS

    start = time.time()
    try:
        model = ChatterboxMultilingualTTS.from_pretrained(device=DEVICE, t3_model=T3)
        name = f"chatterbox-multilingual ({T3 or 'défaut'})"
    except TypeError:
        # Version plus ancienne du paquet : pas de choix de modèle.
        model = ChatterboxMultilingualTTS.from_pretrained(device=DEVICE)
        name = "chatterbox-multilingual"
    log.info("Modèle chargé en %.1f s sur %s", time.time() - start, DEVICE)
    return model, name


def voice_file(voice: str, language: str):
    """Fichier de référence pour une voix, ou None (voix par défaut du modèle)."""
    safe = "".join(c for c in (voice or "") if c.isalnum() or c in "-_").lower()
    if not safe:
        return None
    for candidate in (VOICES_DIR / f"{safe}.{language}.wav", VOICES_DIR / f"{safe}.wav"):
        if candidate.is_file():
            return str(candidate)
    return None


def available_voices():
    if not VOICES_DIR.is_dir():
        return []
    return sorted({p.name.split(".")[0] for p in VOICES_DIR.glob("*.wav")})


def synthesize(text: str, language: str, voice: str) -> bytes:
    model = state["model"]
    prompt = voice_file(voice, language)
    wav = model.generate(text, language_id=language, audio_prompt_path=prompt, exaggeration=0.5, cfg_weight=0.5)
    samples = wav.squeeze(0).detach().cpu().numpy()
    buf = io.BytesIO()
    sf.write(buf, samples, model.sr, subtype="PCM_16", format="WAV")
    return buf.getvalue()


@app.on_event("startup")
async def startup():
    try:
        model, name = await run_in_threadpool(load_model)
        state["model"], state["model_name"] = model, name
        # Chauffe : la première phrase est toujours plus lente.
        await run_in_threadpool(synthesize, "Bonjour Cherif, je suis prêt.", "fr", "prof")
        state["warm"] = True
        log.info("Prêt. Voix disponibles : %s", available_voices() or "aucune (voix par défaut)")
    except Exception as error:  # noqa: BLE001
        state["error"] = str(error)
        log.exception("Chargement impossible")


def check_token(authorization: str | None = Header(default=None)):
    if not TOKEN:
        raise HTTPException(status_code=503, detail="PC_TTS_TOKEN n'est pas réglé sur le PC.")
    if authorization != f"Bearer {TOKEN}":
        raise HTTPException(status_code=401, detail="Mot de passe refusé.")


class TtsBody(BaseModel):
    text: str
    language: str = "fr"
    voice: str = ""


@app.get("/health")
async def health():
    return JSONResponse(
        {
            "ok": state["model"] is not None and state["error"] is None,
            "warm": state["warm"],
            "model": state["model_name"],
            "device": DEVICE,
            "gpu": torch.cuda.get_device_name(0) if torch.cuda.is_available() else None,
            "voices": available_voices(),
            "error": state["error"],
        }
    )


@app.post("/tts", dependencies=[Depends(check_token)])
async def tts(body: TtsBody):
    if state["model"] is None:
        raise HTTPException(status_code=503, detail=state["error"] or "Modèle en cours de chargement, réessaie dans une minute.")
    text = " ".join(body.text.split()).strip()
    if not text:
        raise HTTPException(status_code=400, detail="Texte manquant.")
    if len(text) > MAX_CHARS:
        text = text[:MAX_CHARS]
    language = body.language if body.language in LANGUAGES else "fr"
    start = time.time()
    async with gpu_lock:  # une phrase à la fois sur la carte graphique
        try:
            audio = await run_in_threadpool(synthesize, text, language, body.voice)
        except Exception as error:  # noqa: BLE001
            log.exception("Synthèse impossible")
            raise HTTPException(status_code=500, detail=f"Synthèse impossible : {error}") from error
    log.info("%s · %d caractères · %.1f s", language, len(text), time.time() - start)
    return Response(content=audio, media_type="audio/wav", headers={"Cache-Control": "no-store", "X-Generation-Ms": str(int((time.time() - start) * 1000))})
