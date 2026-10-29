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
import re
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

def clean_env(name: str) -> str:
    """Valeur d'une variable d'environnement sans espaces, retours chariot ni guillemets (fréquents dans un .env écrit à la main)."""
    return os.environ.get(name, "").strip().strip("\r\n").strip().strip("\"'").strip()


TOKEN = clean_env("PC_TTS_TOKEN")
VOICES_DIR = Path(os.environ.get("PC_TTS_VOICES", "/voix"))
T3 = os.environ.get("CHATTERBOX_T3", "v3").strip() or None
DEVICE = "cuda" if torch.cuda.is_available() else "cpu"
LANGUAGES = {"fr", "en"}
MAX_CHARS = 600
# Naturel de la voix : exaggeration = expressivité (0,3 plat … 0,7 très expressif),
# cfg = fidélité au rythme de la référence (0,5 par défaut ; plus bas = débit plus libre et naturel).
EXAGGERATION = float(os.environ.get("CHATTERBOX_EXAGGERATION", "0.5"))
CFG_WEIGHT = float(os.environ.get("CHATTERBOX_CFG", "0.5"))
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


def tidy(samples, sr: int):
    """Rogne le silence aux deux bouts (garde 80 ms), fondu de 15 ms, niveau ramené à -1 dB :
    évite les clics entre deux phrases et les crêtes qui grésillent sur un haut-parleur de téléphone."""
    import numpy as np

    x = np.asarray(samples, dtype=np.float32)
    if x.size < sr // 10:
        return x
    peak = float(np.max(np.abs(x))) or 1.0
    loud = np.where(np.abs(x) > peak * 0.02)[0]
    if loud.size:
        keep = int(sr * 0.08)
        x = x[max(0, loud[0] - keep) : min(x.size, loud[-1] + keep)]
    fade = min(int(sr * 0.015), x.size // 2)
    if fade > 0:
        ramp = np.linspace(0.0, 1.0, fade, dtype=np.float32)
        x[:fade] *= ramp
        x[-fade:] *= ramp[::-1]
    peak = float(np.max(np.abs(x))) or 1.0
    if peak > 0.89:
        x = x * (0.89 / peak)
    return x


# Chatterbox relit et décode le fichier de référence (ffmpeg) et recalcule l'empreinte de la voix à CHAQUE
# `generate(..., audio_prompt_path=…)`. On prépare donc les conditionnels une fois par (fichier, date, moteur)
# et on les garde en mémoire : la phrase suivante part tout de suite sur la carte.
_conds_cache: dict[tuple, object] = {}
FP16 = clean_env("CHATTERBOX_FP16") in ("1", "true", "yes")
# B2 : moteur pour l'anglais. "multilingual" (défaut, français et anglais) ou "turbo" (Chatterbox Turbo, anglais seulement,
# plus léger et plus rapide ; le français reste sur le multilingue). Chargé seulement si demandé.
TTS_ENGINE = (clean_env("PC_TTS_ENGINE") or "multilingual").lower()
# Mesure (étape 0) : les 20 dernières phrases, pour /health et /admin.
RTF_WINDOW = 20
state.setdefault("rtf", [])


def record_rtf(chars: int, gen_s: float, audio_s: float, engine: str):
    rtf = gen_s / audio_s if audio_s > 0 else None
    state["rtf"].append({"chars": chars, "genMs": int(gen_s * 1000), "audioMs": int(audio_s * 1000), "rtf": round(rtf, 2) if rtf else None, "engine": engine})
    del state["rtf"][:-RTF_WINDOW]
    log.info("voix [%s] %d caractères · fabrication %.2f s · audio %.2f s · RTF %s", engine, chars, gen_s, audio_s, f"{rtf:.2f}" if rtf else "?")


def rtf_summary():
    rows = [r for r in state["rtf"] if r["rtf"]]
    if not rows:
        return {"count": 0, "avg": None, "last": None}
    return {"count": len(rows), "avg": round(sum(r["rtf"] for r in rows) / len(rows), 2), "last": rows[-1]["rtf"]}


def engine_for(language: str):
    """(nom, modèle) : Turbo pour l'anglais s'il est chargé, sinon le multilingue."""
    if language == "en" and state.get("turbo") is not None:
        return "turbo", state["turbo"]
    return "multilingual", state["model"]


def available_engines():
    out = []
    if state["model"] is not None:
        out.append("multilingual")
    if state.get("turbo") is not None:
        out.append("turbo")
    return out


def conditionals_for(model, engine: str, prompt: str | None):
    """Conditionnels (empreinte de la voix) préparés une fois par fichier ; rechargés si le fichier change."""
    if not prompt:
        return None
    key = (engine, prompt, os.path.getmtime(prompt))
    conds = _conds_cache.get(key)
    if conds is None:
        start = time.time()
        model.prepare_conditionals(prompt, exaggeration=EXAGGERATION)
        conds = model.conds
        # une seule entrée par (moteur, fichier) : on oublie les anciennes dates
        for k in [k for k in _conds_cache if k[0] == engine and k[1] == prompt]:
            del _conds_cache[k]
        _conds_cache[key] = conds
        log.info("Voix de référence préparée (%s, %s) en %.2f s", engine, os.path.basename(prompt), time.time() - start)
    return conds


def forget_voice(prompt_stem: str | None = None):
    """Après un nouvel enregistrement : on oublie les empreintes concernées (toutes si stem absent)."""
    for k in list(_conds_cache):
        if prompt_stem is None or os.path.basename(k[1]).startswith(prompt_stem):
            del _conds_cache[k]


def synthesize(text: str, language: str, voice: str, engine: str | None = None) -> bytes:
    name, model = engine_for(language) if not engine else (engine, state["turbo"] if engine == "turbo" and state.get("turbo") is not None else state["model"])
    if engine == "turbo" and name != "turbo":
        name = "multilingual"
    prompt = voice_file(voice, language)
    if not prompt and language == "fr":
        log.warning("Aucune voix de référence française dans %s : la voix intégrée a un accent anglais (voir voix/README.md).", VOICES_DIR)
    start = time.time()
    conds = conditionals_for(model, name, prompt)
    if conds is not None:
        model.conds = conds
    kwargs = dict(exaggeration=EXAGGERATION, cfg_weight=CFG_WEIGHT)
    if name == "multilingual":
        kwargs["language_id"] = language
    elif conds is None:
        # Turbo sans référence : il lui en faut une ; on retombe sur le multilingue.
        name, model = "multilingual", state["model"]
        kwargs["language_id"] = language
    if FP16 and DEVICE == "cuda":
        with torch.autocast("cuda", dtype=torch.float16):
            wav = model.generate(text, **kwargs)
    else:
        wav = model.generate(text, **kwargs)
    samples = tidy(wav.squeeze(0).detach().cpu().numpy(), model.sr)
    record_rtf(len(text), time.time() - start, samples.size / model.sr, name)
    buf = io.BytesIO()
    sf.write(buf, samples, model.sr, subtype="PCM_16", format="WAV")
    return buf.getvalue()


def load_turbo():
    from chatterbox.tts_turbo import ChatterboxTurboTTS

    start = time.time()
    state["turbo"] = ChatterboxTurboTTS.from_pretrained(device=DEVICE)
    log.info("Chatterbox Turbo (anglais) chargé en %.1f s", time.time() - start)


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
    if TTS_ENGINE == "turbo":
        try:
            await run_in_threadpool(load_turbo)
            if voice_file("prof", "en"):
                await run_in_threadpool(synthesize, "Hello Cherif, I am ready.", "en", "prof", "turbo")
        except Exception as error:  # noqa: BLE001
            state["turbo_error"] = str(error)
            log.exception("Chatterbox Turbo indisponible : l'anglais reste sur le multilingue")
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


# Whisper « invente » volontiers une phrase sur du bruit ou du silence (fin de vidéo YouTube dans ses données).
# Sur un énoncé court, ces phrases connues sont ignorées ; un segment trop peu sûr aussi.
_NOISE_PHRASES = {
    "thank you", "thanks", "thank you very much", "thanks for watching", "you", "bye", "okay", "ok",
    "merci", "merci beaucoup", "au revoir", "sous-titres réalisés par la communauté d'amara.org", "sous-titres réalisés par l'amara.org",
    "sous-titrage st' 501", "sous-titrage société radio-canada", "amara.org",
}
NO_SPEECH_MAX = 0.6
LOGPROB_MIN = -1.0
SHORT_UTTERANCE_S = 1.5


def is_noise_phrase(text: str) -> bool:
    plain = re.sub(r"[^\w' ]+", " ", text.lower()).strip()
    plain = re.sub(r"\s+", " ", plain)
    return plain in _NOISE_PHRASES or plain.startswith("sous-titres réalisés") or plain.startswith("sous-titrage")


def transcribe(path: str, language: str):
    segments, info = state["stt"].transcribe(path, language=language, beam_size=1, vad_filter=True, word_timestamps=True, condition_on_previous_text=False)
    words = []
    texts = []
    dropped = 0
    for seg in segments:
        if getattr(seg, "no_speech_prob", 0.0) > NO_SPEECH_MAX or getattr(seg, "avg_logprob", 0.0) < LOGPROB_MIN:
            dropped += 1
            continue
        texts.append(seg.text.strip())
        for w in seg.words or []:
            if w.word.strip():
                words.append({"text": w.word.strip(), "start": round(w.start, 3), "end": round(w.end, 3)})
    text = " ".join(t for t in texts if t)
    duration = int((words[-1]["end"] - words[0]["start"]) * 1000) if len(words) >= 1 and words[-1]["end"] > words[0]["start"] else None
    if text and (duration is None or duration < SHORT_UTTERANCE_S * 1000) and is_noise_phrase(text):
        log.info("oreille : « %s » ignoré (phrase typique du bruit sur un énoncé court)", text)
        text, words, duration = "", [], None
    if dropped:
        log.info("oreille : %d segment(s) peu sûr(s) ignoré(s)", dropped)
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
    # "multilingual" | "turbo" : force un moteur (page de comparaison) ; vide = choix automatique.
    engine: str = ""


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
            "live": state.get("vad") is not None and state["stt"] is not None and bool(ANTHROPIC_KEY),
            "claude": state.get("claude"),
            "rtf": rtf_summary(),
            "engines": available_engines(),
            "engine": TTS_ENGINE,
            "turbo_error": state.get("turbo_error"),
            "fp16": FP16,
            "cfg": CFG_WEIGHT,
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
            audio = await run_in_threadpool(synthesize, text, language, body.voice, body.engine or None)
        except Exception as error:  # noqa: BLE001
            log.exception("Synthèse impossible")
            raise HTTPException(status_code=500, detail=f"Synthèse impossible : {error}") from error
    last = state["rtf"][-1] if state["rtf"] else {}
    return Response(
        content=audio,
        media_type="audio/wav",
        headers={"Cache-Control": "no-store", "X-Generation-Ms": str(int((time.time() - start) * 1000)), "X-Audio-Ms": str(last.get("audioMs", 0)), "X-Rtf": str(last.get("rtf") or ""), "X-Engine": str(last.get("engine", ""))},
    )


# ---- B1 : enregistrer une vraie voix depuis le téléphone (Admin → « Enregistrer une voix »)
RECORD_MAX_S = 20
VOICE_NAMES = {"default", "prof", "ami", "grand-frere", "debatteur", "collegue", "situation", "juge"}


@app.post("/voices", dependencies=[Depends(check_token)])
async def upload_voice(audio: UploadFile = File(...), voice: str = Form(...), language: str = Form("fr")):
    """Reçoit un enregistrement (webm, mp4, wav…), le convertit en WAV 24 kHz mono (20 s max) et l'installe
    comme voix de référence `voix/<personnage>.<langue>.wav`. Le dossier doit être en écriture (docker-compose.yml)."""
    safe = "".join(c for c in voice.lower() if c.isalnum() or c in "-_")
    if safe not in VOICE_NAMES:
        raise HTTPException(status_code=400, detail=f"Personnage inconnu : {voice}.")
    lang = language if language in LANGUAGES else "fr"
    data = await audio.read()
    if len(data) < 5000:
        raise HTTPException(status_code=400, detail="Enregistrement vide ou trop court.")
    if len(data) > 20_000_000:
        raise HTTPException(status_code=413, detail="Enregistrement trop long.")
    suffix = os.path.splitext(audio.filename or "")[1] or ".webm"
    with tempfile.NamedTemporaryFile(suffix=suffix, delete=False) as tmp:
        tmp.write(data)
        src = tmp.name

    def convert():
        import librosa
        import numpy as np

        y, _ = librosa.load(src, sr=24000, mono=True)
        y = y[: 24000 * RECORD_MAX_S]
        if y.size < 24000 * 3:
            raise ValueError("Il faut au moins 3 secondes de voix.")
        peak = float(np.max(np.abs(y))) or 1.0
        y = (y / peak) * 0.9
        VOICES_DIR.mkdir(parents=True, exist_ok=True)
        stem = f"{safe}.{lang}"
        for ext in AUDIO_EXT:
            old = VOICES_DIR / f"{stem}{ext}"
            if old.exists() and ext != ".wav":
                old.unlink()
        target = VOICES_DIR / f"{stem}.wav"
        sf.write(str(target), y, 24000, subtype="PCM_16", format="WAV")
        return str(target), y.size / 24000

    try:
        target, seconds = await run_in_threadpool(convert)
    except PermissionError as error:
        raise HTTPException(status_code=500, detail="Le dossier voix est en lecture seule : retire « :ro » sur la ligne « ./voix:/voix » de docker-compose.yml puis relance.") from error
    except ValueError as error:
        raise HTTPException(status_code=400, detail=str(error)) from error
    except Exception as error:  # noqa: BLE001
        log.exception("Enregistrement de voix impossible")
        raise HTTPException(status_code=500, detail=f"Conversion impossible : {error}") from error
    finally:
        try:
            os.unlink(src)
        except OSError:
            pass
    forget_voice(f"{safe}.{lang}")
    log.info("Nouvelle voix de référence : %s (%.1f s)", target, seconds)
    return JSONResponse({"ok": True, "file": os.path.basename(target), "seconds": round(seconds, 1), "voices": available_voices()})


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


# ---------------------------------------------------------------------------
# V5 : mode temps réel. Le téléphone envoie le micro en continu (PCM 16 kHz,
# 16 bits, mono) par WebSocket ; le PC détecte la fin de phrase (Silero VAD),
# transcrit (Whisper), fait répondre Claude en flux et renvoie la voix
# (Chatterbox) phrase par phrase. Si Cherif parle pendant que le personnage
# parle, on le coupe. Authentification : ticket signé par l'app avec PC_TTS_TOKEN.
# ---------------------------------------------------------------------------
import hashlib
import hmac
import json
import re

import numpy as np
from fastapi import WebSocket, WebSocketDisconnect

ANTHROPIC_KEY = clean_env("ANTHROPIC_API_KEY")
ANTHROPIC_MODEL = clean_env("ANTHROPIC_MODEL") or "claude-haiku-5-5"


def key_hint(key: str) -> str | None:
    """Pour vérifier la clé sans la montrer : début, fin et longueur."""
    if not key:
        return None
    return f"{key[:12]}…{key[-4:]} ({len(key)} caractères)"


async def check_claude():
    """Au démarrage : la clé est-elle acceptée par Anthropic ? Visible dans /health (claude)."""
    state["claude"] = {"configured": bool(ANTHROPIC_KEY), "ok": False, "hint": key_hint(ANTHROPIC_KEY), "model": ANTHROPIC_MODEL, "error": None}
    if not ANTHROPIC_KEY:
        state["claude"]["error"] = "ANTHROPIC_API_KEY absente de pc-voix/.env"
        return
    try:
        from anthropic import AsyncAnthropic

        client = AsyncAnthropic(api_key=ANTHROPIC_KEY)
        await client.models.list(limit=1)
        state["claude"]["ok"] = True
        log.info("Clé Anthropic acceptée (%s)", key_hint(ANTHROPIC_KEY))
    except Exception as error:  # noqa: BLE001
        msg = str(error)
        state["claude"]["error"] = ("clé refusée par Anthropic (401) : vérifie-la sur console.anthropic.com → API Keys" if "401" in msg or "authentication" in msg.lower() else msg[:200])
        log.warning("Clé Anthropic : %s", state["claude"]["error"])
SR = 16000
WINDOW = 512  # taille de fenêtre du VAD Silero à 16 kHz (32 ms)
START_WINDOWS = 3  # ≈ 100 ms de voix pour commencer une prise de parole
END_SILENCE_WINDOWS = int(0.7 * SR / WINDOW)  # ≈ 700 ms de silence = fin de phrase
BARGE_WINDOWS = 19  # ≈ 600 ms de voix nette (> 0,85) pendant que le personnage parle : candidat à l'interruption
BARGE_PROB = 0.85
BARGE_VERIFY_S = 1.0  # après ≈ 1 s de voix, on vérifie par Whisper avant de couper
BARGE_MIN_WORDS = 2
ECHO_MAX_SIMILARITY = 0.5  # texte trop proche de ce que le personnage vient de dire = écho de sa propre voix
GROUP_CHARS = 120  # après la première phrase, on regroupe jusqu'à ≈ 120 caractères par morceau de voix
MAX_UTTERANCE_S = 45
PARTIAL_EVERY_S = 1.0
PAD_WINDOWS = 10  # ≈ 320 ms gardés avant le début détecté


def load_vad():
    from silero_vad import load_silero_vad

    state["vad"] = load_silero_vad()
    log.info("VAD Silero chargé")


state.setdefault("vad", None)


@app.on_event("startup")
async def startup_live():
    try:
        await run_in_threadpool(load_vad)
    except Exception as error:  # noqa: BLE001
        state["vad_error"] = str(error)
        log.exception("VAD indisponible : pas de mode temps réel")
    await check_claude()
    if not ANTHROPIC_KEY:
        log.warning("ANTHROPIC_API_KEY absente de pc-voix/.env : le mode temps réel ne pourra pas répondre.")


def verify_ticket(ticket: str) -> bool:
    if not TOKEN or not ticket or "." not in ticket:
        return False
    exp, _, sig = ticket.partition(".")
    if not exp.isdigit() or int(exp) < time.time() * 1000:
        return False
    expected = hmac.new(TOKEN.encode(), exp.encode(), hashlib.sha256).hexdigest()
    return hmac.compare_digest(expected, sig)


_SENTENCE_END = re.compile(r"[.!?…]+[\"»”)]?\s+")
_ABBREV = re.compile(r"\b(M|Mme|Mlle|Dr|St|etc|ex|cf|p)\.\s*$", re.I)


class SentenceBuffer:
    """Même découpage que le téléphone : phrases complètes, jamais dans une balise <voice>."""

    def __init__(self):
        self.pending = ""

    def push(self, delta: str):
        self.pending += delta
        out = []
        while True:
            m = _SENTENCE_END.search(self.pending)
            if not m:
                break
            candidate = self.pending[: m.end()]
            if candidate.rfind("<voice") > candidate.rfind("</voice>"):
                break
            if len(candidate.strip()) < 15 or _ABBREV.search(candidate.rstrip()):
                # on cherche la fin de phrase suivante
                nxt = _SENTENCE_END.search(self.pending, m.end())
                if not nxt:
                    break
                candidate = self.pending[: nxt.end()]
                if candidate.rfind("<voice") > candidate.rfind("</voice>"):
                    break
                m = nxt
            out.append(candidate.strip())
            self.pending = self.pending[m.end() :]
        return out

    def flush(self):
        rest = self.pending.strip()
        self.pending = ""
        return rest or None


def strip_voice_tags(text: str) -> str:
    return re.sub(r"\s+", " ", re.sub(r"</?voice[^>]*>", "", text)).strip()


def wav_seconds(wav: bytes, sr: int) -> float:
    return max(0.0, (len(wav) - 44) / 2 / sr)


class LiveSession:
    def __init__(self, ws: WebSocket, start: dict):
        self.ws = ws
        self.prompt = str(start.get("prompt") or "")
        self.language = start.get("language") if start.get("language") in LANGUAGES else "fr"
        self.voice = str(start.get("voice") or "prof")
        self.first_message = str(start.get("firstMessage") or "")
        self.history = [h for h in (start.get("history") or []) if isinstance(h, dict) and h.get("role") in ("user", "agent") and isinstance(h.get("text"), str)]
        self.closed = False
        self.vad = state["vad"]
        self.respond_task: asyncio.Task | None = None
        self.partial_task: asyncio.Task | None = None
        self.speaking_until = 0.0
        # Ce que le téléphone joue vraiment (commande « playback ») ; sinon on se rabat sur speaking_until.
        self.playback_known = False
        self.playing = False
        # Barge-in en attente de vérification (voix pendant que le personnage parle).
        self.pending_barge = False
        self.barge_verified_at = 0.0
        # Dernières phrases dites par le personnage (pour reconnaître l'écho de sa propre voix).
        self.spoken_recent: list[str] = []
        self.turn_id = 0
        self.last_agent_text: str | None = None
        # état de l'oreille
        self.residual = np.zeros(0, dtype=np.float32)
        self.pad: list[np.ndarray] = []
        self.utter: list[np.ndarray] = []
        self.in_speech = False
        self.speech_windows = 0
        self.silence_windows = 0
        self.barge_windows = 0
        self.utter_started = 0.0
        self.last_partial = 0.0
        self.last_frame_at = 0.0

    async def send(self, event: dict):
        if not self.closed:
            await self.ws.send_text(json.dumps(event, ensure_ascii=False))

    # ---- boucle principale
    async def run(self):
        await self.send({"type": "ready"})
        if self.first_message:
            self.respond_task = asyncio.create_task(self.speak_text(self.first_message, record=True))
        watchdog = asyncio.create_task(self.watchdog())
        try:
            while not self.closed:
                message = await self.ws.receive()
                if message.get("type") == "websocket.disconnect":
                    break
                try:
                    if message.get("bytes") is not None:
                        self.on_audio(message["bytes"])
                    elif message.get("text"):
                        await self.on_command(json.loads(message["text"]))
                except Exception:  # noqa: BLE001
                    # Une trame ou une commande qui casse ne doit pas couper la séance.
                    log.exception("Message ignoré (temps réel)")
        except WebSocketDisconnect:
            pass
        except Exception:  # noqa: BLE001
            log.exception("Session temps réel interrompue")
        finally:
            self.closed = True
            watchdog.cancel()
            self.cancel_response()

    async def watchdog(self):
        """Plus de trames depuis 800 ms en pleine phrase (micro coupé, appui relâché) : on termine la phrase."""
        while not self.closed:
            await asyncio.sleep(0.2)
            if self.in_speech and self.last_frame_at and time.time() - self.last_frame_at > 0.8:
                await self.end_turn()

    async def on_command(self, cmd: dict):
        kind = cmd.get("type")
        if kind == "interrupt":
            self.cancel_response()
            self.speaking_until = 0.0
            self.playing = False
        elif kind == "playback":
            self.playback_known = True
            self.playing = bool(cmd.get("playing"))
            if not self.playing:
                self.speaking_until = 0.0
        elif kind == "flush":
            if self.in_speech or self.utter:
                await self.end_turn()
        elif kind == "repeat":
            if self.last_agent_text and (self.respond_task is None or self.respond_task.done()):
                self.respond_task = asyncio.create_task(self.speak_text(self.last_agent_text, record=False))
        elif kind == "text":
            # Saisie au clavier : même chemin qu'une phrase transcrite.
            text = str(cmd.get("text") or "").strip()[:600]
            if len(text) >= 2:
                self.in_speech = False
                self.utter = []
                self.cancel_response()
                await self.send({"type": "user", "text": text})
                self.history.append({"role": "user", "text": text})
                self.respond_task = asyncio.create_task(self.respond())
        elif kind == "end":
            self.closed = True
            await self.ws.close()

    def cancel_response(self):
        if self.respond_task and not self.respond_task.done():
            self.respond_task.cancel()
        self.respond_task = None

    # ---- oreille
    def on_audio(self, data: bytes):
        self.last_frame_at = time.time()
        if len(data) % 2:
            data = data[:-1]
        pcm = np.frombuffer(data, dtype=np.int16).astype(np.float32) / 32768.0
        buf = np.concatenate([self.residual, pcm]) if self.residual.size else pcm
        n = buf.size // WINDOW
        for i in range(n):
            self.on_window(buf[i * WINDOW : (i + 1) * WINDOW])
        self.residual = buf[n * WINDOW :]

    def on_window(self, window: np.ndarray):
        import torch

        prob = float(self.vad(torch.from_numpy(np.ascontiguousarray(window)), SR).item())
        now = time.time()
        # Personnage occupé = une réponse est en cours (Claude écrit, voix en fabrication ou en lecture).
        # Pendant ce temps, aucune prise de parole « normale » : seul le chemin barge-in, vérifié, peut couper.
        agent_busy = self.agent_busy(now)
        if not self.in_speech:
            self.pad.append(window)
            if len(self.pad) > PAD_WINDOWS:
                self.pad.pop(0)
            if agent_busy:
                self.barge_windows = self.barge_windows + 1 if prob > BARGE_PROB else 0
                if self.barge_windows >= BARGE_WINDOWS:
                    # On enregistre sans rien couper : Whisper confirmera (≥ 2 mots, pas l'écho du personnage).
                    self.pending_barge = True
                    self.begin_utterance(now)
                return
            self.speech_windows = self.speech_windows + 1 if prob > 0.5 else 0
            if self.speech_windows >= START_WINDOWS:
                self.begin_utterance(now)
            return
        self.utter.append(window)
        if prob < 0.35:
            self.silence_windows += 1
        else:
            self.silence_windows = 0
        if self.silence_windows >= END_SILENCE_WINDOWS or now - self.utter_started > MAX_UTTERANCE_S:
            asyncio.get_event_loop().create_task(self.end_turn())
        elif self.pending_barge and now - self.utter_started > BARGE_VERIFY_S and (self.partial_task is None or self.partial_task.done()):
            # Barge-in : vérification au plus tôt, pour couper vite si c'est bien Cherif.
            self.last_partial = now
            self.partial_task = asyncio.get_event_loop().create_task(self.send_partial())
        elif now - self.last_partial > PARTIAL_EVERY_S and (self.partial_task is None or self.partial_task.done()):
            self.last_partial = now
            self.partial_task = asyncio.get_event_loop().create_task(self.send_partial())

    def agent_busy(self, now: float) -> bool:
        responding = self.respond_task is not None and not self.respond_task.done()
        speaking = self.playing if self.playback_known else now < self.speaking_until
        return responding or speaking

    def looks_like_echo(self, text: str) -> bool:
        """Vrai si le texte ressemble à ce que le personnage vient de dire (écho de sa propre voix dans le micro)."""
        plain = re.sub(r"[^\w' ]+", " ", text.lower()).strip()
        if not plain:
            return True
        for said in self.spoken_recent[-4:]:
            ref = re.sub(r"[^\w' ]+", " ", said.lower()).strip()
            if not ref:
                continue
            if plain in ref or ref in plain:
                return True
            # distance d'édition normalisée sur les mots
            a, b = plain.split(), ref.split()
            if not a or not b:
                continue
            prev = list(range(len(b) + 1))
            for i in range(1, len(a) + 1):
                cur = [i]
                for j in range(1, len(b) + 1):
                    cur.append(min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (0 if a[i - 1] == b[j - 1] else 1)))
                prev = cur
            if prev[-1] / max(len(a), len(b)) < ECHO_MAX_SIMILARITY:
                return True
        return False

    def confirm_barge(self, text: str) -> bool:
        """Barge-in accepté : au moins 2 mots et pas l'écho du personnage. Sinon on jette l'énoncé."""
        words = [w for w in re.split(r"\s+", text.strip()) if w]
        if len(words) >= BARGE_MIN_WORDS and not self.looks_like_echo(text):
            return True
        return False

    def accept_barge(self):
        self.pending_barge = False
        self.cancel_response()
        self.speaking_until = 0.0
        self.playing = False
        asyncio.get_event_loop().create_task(self.send({"type": "interrupt"}))

    def drop_utterance(self, why: str):
        log.info("oreille (temps réel) : énoncé ignoré (%s)", why)
        self.in_speech = False
        self.pending_barge = False
        self.utter = []
        self.turn_id += 1

    def begin_utterance(self, now: float):
        self.in_speech = True
        self.utter = list(self.pad)
        self.pad = []
        self.speech_windows = 0
        self.silence_windows = 0
        self.barge_windows = 0
        self.utter_started = now
        self.last_partial = now
        self.turn_id += 1
        try:
            self.vad.reset_states()
        except Exception:  # noqa: BLE001
            pass

    def utterance_path(self) -> str | None:
        if not self.utter:
            return None
        audio = np.concatenate(self.utter)
        if audio.size < SR * 0.3:
            return None
        with tempfile.NamedTemporaryFile(suffix=".wav", delete=False) as tmp:
            sf.write(tmp.name, audio, SR, subtype="PCM_16", format="WAV")
            return tmp.name

    async def send_partial(self):
        turn = self.turn_id
        path = self.utterance_path()
        if not path:
            return
        try:
            async with stt_lock:
                result = await run_in_threadpool(transcribe, path, self.language)
        except Exception:  # noqa: BLE001
            return
        finally:
            os.unlink(path)
        if turn != self.turn_id or not self.in_speech:
            return
        if self.pending_barge:
            if self.confirm_barge(result["text"]):
                log.info("barge-in confirmé : « %s »", result["text"][:60])
                self.accept_barge()
            elif result["text"] and self.looks_like_echo(result["text"]):
                self.drop_utterance(f"écho du personnage : « {result['text'][:40]} »")
                return
        if result["text"]:
            await self.send({"type": "partial", "text": result["text"]})

    async def end_turn(self):
        if not self.in_speech:
            return
        self.in_speech = False
        path = self.utterance_path()
        self.utter = []
        if not path:
            return
        start = time.time()
        try:
            async with stt_lock:
                result = await run_in_threadpool(transcribe, path, self.language)
        except Exception as error:  # noqa: BLE001
            log.exception("Transcription impossible")
            await self.send({"type": "error", "message": f"Transcription impossible : {error}", "fatal": False})
            return
        finally:
            os.unlink(path)
        text = result["text"].strip()
        log.info("oreille (temps réel) %.2f s · « %s »", time.time() - start, text[:80])
        if len(text) < 2:
            self.pending_barge = False
            return
        if self.pending_barge:
            # Voix entendue pendant que le personnage parlait : on ne coupe que si c'est vraiment Cherif.
            if not self.confirm_barge(text):
                self.drop_utterance(f"pas une vraie interruption : « {text[:40]} »")
                return
            self.accept_barge()
        elif self.agent_busy(time.time()) and self.looks_like_echo(text):
            self.drop_utterance(f"écho pendant la réponse : « {text[:40]} »")
            return
        self.cancel_response()
        await self.send({"type": "user", "text": text})
        self.history.append({"role": "user", "text": text})
        self.respond_task = asyncio.create_task(self.respond())

    # ---- cerveau et voix
    def claude_messages(self):
        messages = []
        opening = []
        for line in self.history[-40:]:
            role = "user" if line["role"] == "user" else "assistant"
            if not messages and role == "assistant":
                opening.append(line["text"])
                continue
            if messages and messages[-1]["role"] == role:
                messages[-1]["content"] += "\n" + line["text"]
            else:
                messages.append({"role": role, "content": line["text"]})
        system = self.prompt
        if opening:
            system += ("\n\nYou opened the conversation with: " if self.language == "en" else "\n\nTu as ouvert la discussion avec : ") + " ".join(opening)
        return system, messages

    async def respond(self):
        if not ANTHROPIC_KEY:
            await self.send({"type": "error", "message": "ANTHROPIC_API_KEY manque dans pc-voix/.env : le PC ne peut pas faire répondre Claude.", "fatal": True})
            return
        from anthropic import AsyncAnthropic

        client = AsyncAnthropic(api_key=ANTHROPIC_KEY)
        system, messages = self.claude_messages()
        if not messages or messages[-1]["role"] != "user":
            return
        started = time.time()
        buffer = SentenceBuffer()
        full = ""
        seq = 0
        first_sentence_at = None
        group: list[str] = []
        self.spoken_recent = []

        async def speak_group():
            nonlocal seq
            if not group:
                return
            seq += 1
            joined = " ".join(group)
            group.clear()
            await self.speak_sentence(joined, seq, claude_ms=int((first_sentence_at - started) * 1000) if seq == 1 and first_sentence_at else None)

        async def on_sentence(sentence: str):
            nonlocal first_sentence_at
            if first_sentence_at is None:
                first_sentence_at = time.time()
            # La première phrase part seule (démarrage rapide) ; les suivantes sont regroupées (≈ 120 caractères)
            # pour que chaque morceau se fabrique pendant que le précédent se lit.
            if seq == 0:
                group.append(sentence)
                await speak_group()
                return
            # on ne mélange pas le juge et Leo dans un même morceau
            if group and (("<voice" in sentence) != ("<voice" in group[0])):
                await speak_group()
            group.append(sentence)
            if sum(len(g) for g in group) >= GROUP_CHARS:
                await speak_group()

        try:
            kwargs = dict(model=ANTHROPIC_MODEL, max_tokens=2048, system=system, messages=messages, thinking={"type": "disabled"})
            try:
                stream_cm = client.messages.stream(output_config={"effort": "medium"}, **kwargs)
                stream = await stream_cm.__aenter__()
            except TypeError:
                stream_cm = client.messages.stream(**kwargs)
                stream = await stream_cm.__aenter__()
            try:
                async for delta in stream.text_stream:
                    full += delta
                    await self.send({"type": "delta", "text": delta})
                    for sentence in buffer.push(delta):
                        await on_sentence(sentence)
            finally:
                await stream_cm.__aexit__(None, None, None)
            rest = buffer.flush()
            if rest:
                if first_sentence_at is None:
                    first_sentence_at = time.time()
                group.append(rest)
            await speak_group()
            text = full.strip()
            if not text:
                text = "Pardon, j'ai eu un petit souci de mon côté. Tu peux redire ta phrase ?" if self.language == "fr" else "Sorry, I had a small hiccup on my side. Can you say that again?"
                await self.speak_sentence(text, 1)
            self.last_agent_text = text
            self.history.append({"role": "agent", "text": text})
            await self.send({"type": "agent", "text": strip_voice_tags(text)})
        except asyncio.CancelledError:
            said = strip_voice_tags(full)
            if said:
                self.history.append({"role": "agent", "text": said})
            raise
        except Exception as error:  # noqa: BLE001
            log.exception("Claude (temps réel)")
            msg = str(error)
            fatal = "401" in msg or "authentication" in msg.lower()
            await self.send({"type": "error", "message": ("Clé Anthropic refusée (pc-voix/.env)." if fatal else f"Claude n'a pas répondu : {msg[:120]}"), "fatal": fatal})

    async def speak_sentence(self, sentence: str, seq: int, claude_ms: int | None = None) -> int:
        start = time.time()
        plain = strip_voice_tags(sentence)
        if not plain:
            return 0
        role_voice = "juge" if re.search(r"<voice\s+name=[\"']?(judge|juge)", sentence, re.I) else self.voice
        async with gpu_lock:
            audio = await run_in_threadpool(synthesize, plain, self.language, role_voice)
        ms = int((time.time() - start) * 1000)
        audio_s = wav_seconds(audio, state["model"].sr)
        self.spoken_recent.append(plain)
        del self.spoken_recent[:-6]
        await self.send({"type": "speak", "text": plain, "seq": seq})
        if not self.closed:
            await self.ws.send_bytes(audio)
        # Étape 0 : un `timing` par morceau (fabrication, durée, RTF) ; `claudeMs` seulement sur le premier.
        await self.send({"type": "timing", "seq": seq, "claudeMs": claude_ms, "voiceMs": ms, "audioMs": int(audio_s * 1000), "rtf": round(ms / 1000 / audio_s, 2) if audio_s > 0 else None})
        now = time.time()
        self.speaking_until = max(now, self.speaking_until) + audio_s + 0.3
        return ms

    async def speak_text(self, text: str, record: bool):
        try:
            self.spoken_recent = []
            sentences = SentenceBuffer().push(text + " ") or [text]
            pieces: list[str] = [sentences[0]]
            for sentence in sentences[1:]:
                if len(pieces) > 1 and len(pieces[-1]) + len(sentence) < GROUP_CHARS:
                    pieces[-1] = f"{pieces[-1]} {sentence}"
                else:
                    pieces.append(sentence)
            for i, piece in enumerate(pieces, start=1):
                await self.speak_sentence(piece, i)
            if record:
                self.last_agent_text = text
                self.history.append({"role": "agent", "text": text})
                await self.send({"type": "agent", "text": strip_voice_tags(text)})
        except asyncio.CancelledError:
            raise
        except Exception as error:  # noqa: BLE001
            log.exception("Lecture impossible")
            await self.send({"type": "error", "message": f"Voix impossible : {error}", "fatal": False})


@app.websocket("/live")
async def live(ws: WebSocket):
    await ws.accept()
    try:
        first = json.loads(await asyncio.wait_for(ws.receive_text(), timeout=15))
    except Exception:  # noqa: BLE001
        await ws.close()
        return
    if first.get("type") != "start" or not verify_ticket(str(first.get("ticket", ""))):
        await ws.send_text(json.dumps({"type": "error", "message": "Ticket refusé : PC_TTS_TOKEN doit être identique dans Vercel et dans pc-voix/.env.", "fatal": True}))
        await ws.close()
        return
    missing = []
    if state["model"] is None:
        missing.append("la voix (Chatterbox)")
    if state["stt"] is None:
        missing.append("l'oreille (Whisper)")
    if state["vad"] is None:
        missing.append("la détection de voix (Silero)")
    if not ANTHROPIC_KEY:
        missing.append("la clé Anthropic (ANTHROPIC_API_KEY dans pc-voix/.env)")
    elif state.get("claude") and not state["claude"]["ok"]:
        missing.append(f"une clé Anthropic valable ({state['claude']['error']})")
    if missing:
        await ws.send_text(json.dumps({"type": "error", "message": "Le PC n'est pas prêt pour le temps réel : il manque " + ", ".join(missing) + ".", "fatal": True}, ensure_ascii=False))
        await ws.close()
        return
    session = LiveSession(ws, first)
    log.info("Session temps réel ouverte (%s, voix %s)", session.language, session.voice)
    await session.run()
    log.info("Session temps réel fermée")
