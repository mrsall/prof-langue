"""
Serveur de voix pour le PC de Cherif (carte NVIDIA) : fabrique l'audio d'une
phrase avec Chatterbox Multilingue (libre, licence MIT), en français et en
anglais, et le renvoie en WAV. L'app sur Vercel l'appelle à travers un tunnel
Tailscale, avec un mot de passe partagé (PC_TTS_TOKEN).

  GET  /health                       → { ok, model, device, voices, warm, stt }
  POST /tts  { text, language, voice } → audio/wav   (Authorization: Bearer <PC_TTS_TOKEN>)
  POST /stt  (multipart audio, language) → { text, words, durationMs }   (Whisper sur le GPU, même mot de passe)

Les voix : Chatterbox COPIE la voix (et l'accent) d'un fichier de référence.
Sa voix intégrée est celle d'un anglophone : en français, il faut une référence
de francophone. Fichiers dans ./voix (wav, mp3, m4a, ogg, flac ; seules les
premières secondes servent), cherchés dans cet ordre :
  <personnage>.<langue>.ext  (prof.fr.mp3)   > <personnage>.ext  (prof.mp3)
  > default.<langue>.ext  (default.fr.mp3)   > default.ext        > voix intégrée
"""
import asyncio
import io
import logging
import os
import tempfile
import time
from pathlib import Path

import soundfile as sf
import torch
from fastapi import Depends, FastAPI, File, Form, Header, HTTPException, UploadFile
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
# Naturel de la voix : exaggeration = expressivité (0,3 plat … 0,7 très expressif),
# cfg = fidélité au rythme de la référence (0,5 par défaut ; plus bas = débit plus libre et naturel).
EXAGGERATION = float(os.environ.get("CHATTERBOX_EXAGGERATION", "0.6"))
CFG_WEIGHT = float(os.environ.get("CHATTERBOX_CFG", "0.4"))
WHISPER_MODEL = os.environ.get("WHISPER_MODEL", "large-v3-turbo").strip()
AUDIO_EXT = (".wav", ".mp3", ".m4a", ".ogg", ".flac", ".aac", ".opus")

app = FastAPI(title="prof-langue · voix du PC")
state = {"model": None, "warm": False, "model_name": None, "error": None, "stt": None, "stt_name": None, "stt_error": None}
gpu_lock = asyncio.Lock()
stt_lock = asyncio.Lock()


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


def _find(stem: str):
    for ext in AUDIO_EXT:
        candidate = VOICES_DIR / f"{stem}{ext}"
        if candidate.is_file():
            return str(candidate)
    return None


def voice_file(voice: str, language: str):
    """Fichier de référence pour une voix et une langue, ou None (voix intégrée du modèle)."""
    safe = "".join(c for c in (voice or "") if c.isalnum() or c in "-_").lower()
    stems = ([f"{safe}.{language}", safe] if safe else []) + [f"default.{language}", "default"]
    for stem in stems:
        found = _find(stem)
        if found:
            return found
    return None


def available_voices():
    """Noms des fichiers de référence présents (sans extension), ex. ["default.fr", "prof", "prof.en"]."""
    if not VOICES_DIR.is_dir():
        return []
    return sorted({p.name[: -len(p.suffix)] for p in VOICES_DIR.iterdir() if p.suffix.lower() in AUDIO_EXT})


def synthesize(text: str, language: str, voice: str) -> bytes:
    model = state["model"]
    prompt = voice_file(voice, language)
    if not prompt and language == "fr":
        log.warning("Aucune voix de référence française dans %s : la voix intégrée a un accent anglais (voir voix/README.md).", VOICES_DIR)
    wav = model.generate(text, language_id=language, audio_prompt_path=prompt, exaggeration=EXAGGERATION, cfg_weight=CFG_WEIGHT)
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
    # L'oreille (Whisper) : facultative, la voix marche sans elle.
    try:
        await run_in_threadpool(load_whisper)
    except Exception as error:  # noqa: BLE001
        state["stt_error"] = str(error)
        log.exception("Whisper indisponible (l'oreille du PC ne sera pas proposée)")


def load_whisper():
    from faster_whisper import WhisperModel

    start = time.time()
    try:
        model = WhisperModel(WHISPER_MODEL, device="cuda", compute_type="float16")
        name = f"faster-whisper {WHISPER_MODEL} (cuda)"
    except Exception as error:  # noqa: BLE001
        log.warning("Whisper sur GPU impossible (%s), essai sur le processeur", error)
        model = WhisperModel(WHISPER_MODEL, device="cpu", compute_type="int8")
        name = f"faster-whisper {WHISPER_MODEL} (cpu, lent)"
    # Chauffe sur une seconde de silence.
    with tempfile.NamedTemporaryFile(suffix=".wav", delete=False) as tmp:
        sf.write(tmp.name, [0.0] * 16000, 16000, subtype="PCM_16", format="WAV")
        list(model.transcribe(tmp.name, language="fr", beam_size=1)[0])
    os.unlink(tmp.name)
    state["stt"], state["stt_name"] = model, name
    log.info("Whisper chargé en %.1f s : %s", time.time() - start, name)


def transcribe(path: str, language: str):
    segments, info = state["stt"].transcribe(path, language=language, beam_size=1, vad_filter=True, word_timestamps=True, condition_on_previous_text=False)
    words = []
    texts = []
    for seg in segments:
        texts.append(seg.text.strip())
        for w in seg.words or []:
            if w.word.strip():
                words.append({"text": w.word.strip(), "start": round(w.start, 3), "end": round(w.end, 3)})
    text = " ".join(t for t in texts if t)
    duration = int((words[-1]["end"] - words[0]["start"]) * 1000) if len(words) >= 1 and words[-1]["end"] > words[0]["start"] else None
    return {"text": text, "words": words, "durationMs": duration, "language": info.language}


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
            "french_reference": voice_file("prof", "fr") is not None,
            "stt": state["stt_name"],
            "stt_error": state["stt_error"],
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


@app.post("/stt", dependencies=[Depends(check_token)])
async def stt(audio: UploadFile = File(...), language: str = Form("fr")):
    if state["stt"] is None:
        raise HTTPException(status_code=503, detail=state["stt_error"] or "Whisper en cours de chargement, réessaie dans une minute.")
    lang = language if language in LANGUAGES else "fr"
    data = await audio.read()
    if len(data) < 1000:
        raise HTTPException(status_code=400, detail="Enregistrement vide.")
    if len(data) > 12_000_000:
        raise HTTPException(status_code=413, detail="Enregistrement trop long.")
    start = time.time()
    with tempfile.NamedTemporaryFile(suffix=".wav", delete=False) as tmp:
        tmp.write(data)
        path = tmp.name
    try:
        async with stt_lock:
            result = await run_in_threadpool(transcribe, path, lang)
    except Exception as error:  # noqa: BLE001
        log.exception("Transcription impossible")
        raise HTTPException(status_code=500, detail=f"Transcription impossible : {error}") from error
    finally:
        try:
            os.unlink(path)  # l'audio n'est jamais conservé
        except OSError:
            pass
    log.info("oreille %s · %d octets · %.2f s · « %s »", lang, len(data), time.time() - start, result["text"][:60])
    return JSONResponse(result)
