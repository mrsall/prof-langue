"use client";

import { useEffect, useRef, useState } from "react";
import { LANGUAGE_LABELS, PERSONALITIES, type Language } from "@/config/personalities";

/**
 * B1 : enregistrer une vraie voix pour un personnage, depuis le téléphone, et
 * l'envoyer au PC (voix de référence de Chatterbox). Les 14 voix livrées sont des
 * voix de synthèse Piper : Chatterbox clonait une voix déjà robotique.
 * Un texte vivant de ≈ 15 s est affiché ; on enregistre, on réécoute, on envoie.
 */
const SCRIPTS: Record<Language, string> = {
  fr: "Ah, salut ! Alors, raconte-moi : qu'est-ce que tu as fait ce week-end ? Moi, j'ai regardé le match avec des amis, on a crié comme des fous à la fin. Et toi, tu préfères le foot ou les jeux vidéo ? Vas-y, je t'écoute, prends ton temps.",
  en: "Hey, good to see you! So tell me, what did you do this weekend? I watched the game with some friends, and we went crazy at the end. What about you, do you prefer soccer or video games? Go ahead, I'm listening, take your time.",
};

const VOICE_CHOICES: { key: string; label: string }[] = [
  ...PERSONALITIES.filter((p) => p.id !== "situation").map((p) => ({ key: p.id, label: p.name })),
  { key: "situation", label: "Mise en situation" },
  { key: "juge", label: "Le juge (débat)" },
  { key: "default", label: "Voix par défaut" },
];

const MAX_SECONDS = 20;

type Status = "idle" | "recording" | "recorded" | "sending" | "sent" | "error";

export function VoiceRecorder({ voices }: { voices: string[] }) {
  const [voice, setVoice] = useState("prof");
  const [language, setLanguage] = useState<Language>("fr");
  const [status, setStatus] = useState<Status>("idle");
  const [seconds, setSeconds] = useState(0);
  const [message, setMessage] = useState<string | null>(null);
  const [blob, setBlob] = useState<Blob | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<BlobPart[]>([]);
  const timerRef = useRef<number | null>(null);
  const supported = typeof window !== "undefined" && typeof MediaRecorder !== "undefined" && Boolean(navigator.mediaDevices?.getUserMedia);

  useEffect(
    () => () => {
      if (timerRef.current) clearInterval(timerRef.current);
      if (previewUrl) URL.revokeObjectURL(previewUrl);
    },
    [previewUrl],
  );

  const stop = () => {
    const rec = recorderRef.current;
    if (rec && rec.state !== "inactive") rec.stop();
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
  };

  const start = async () => {
    setMessage(null);
    setBlob(null);
    if (previewUrl) {
      URL.revokeObjectURL(previewUrl);
      setPreviewUrl(null);
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1, echoCancellation: false, noiseSuppression: true, autoGainControl: true } });
      const mime = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4", "audio/ogg;codecs=opus"].find((m) => MediaRecorder.isTypeSupported(m));
      const rec = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined);
      chunksRef.current = [];
      rec.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data);
      };
      rec.onstop = () => {
        stream.getTracks().forEach((t) => t.stop());
        const out = new Blob(chunksRef.current, { type: rec.mimeType || "audio/webm" });
        setBlob(out);
        setPreviewUrl(URL.createObjectURL(out));
        setStatus("recorded");
      };
      recorderRef.current = rec;
      rec.start(250);
      setSeconds(0);
      setStatus("recording");
      navigator.vibrate?.(20);
      timerRef.current = window.setInterval(() => {
        setSeconds((n) => {
          if (n + 1 >= MAX_SECONDS) stop();
          return n + 1;
        });
      }, 1000);
    } catch (error) {
      setStatus("error");
      setMessage(error instanceof Error && error.name === "NotAllowedError" ? "Le micro est refusé : autorise-le dans les réglages du navigateur." : "Micro indisponible sur ce téléphone.");
    }
  };

  const send = async () => {
    if (!blob) return;
    setStatus("sending");
    setMessage(null);
    const form = new FormData();
    const ext = blob.type.includes("mp4") ? "mp4" : blob.type.includes("ogg") ? "ogg" : blob.type.includes("wav") ? "wav" : "webm";
    form.append("audio", blob, `voix.${ext}`);
    form.append("voice", voice);
    form.append("language", language);
    try {
      const res = await fetch("/api/voix-pc", { method: "POST", body: form });
      const data = (await res.json().catch(() => ({}))) as { ok?: boolean; file?: string; seconds?: number; error?: string };
      if (res.ok && data.ok) {
        setStatus("sent");
        setMessage(`Voix enregistrée sur le PC (${data.file}, ${data.seconds ?? "?"} s). Le prochain « Tester la voix de mon PC » l'utilise.`);
      } else {
        setStatus("error");
        setMessage(data.error ?? `Le serveur a répondu ${res.status}.`);
      }
    } catch {
      setStatus("error");
      setMessage("Pas de connexion. Réessaie.");
    }
  };

  const current = `${voice}.${language}`;
  const hasOwn = voices.includes(current);

  return (
    <section className="flex flex-col gap-3 rounded-2xl border border-line bg-elevated p-4">
      <div className="flex items-center justify-between">
        <h2 className="text-base font-semibold">Enregistrer une voix</h2>
        <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${hasOwn ? "bg-speaking/15 text-speaking" : "bg-listening/15 text-listening"}`}>{hasOwn ? "Voix personnalisée" : "Voix de synthèse"}</span>
      </div>
      <p className="text-sm text-muted">
        Le PC copie le timbre et la façon de parler de l&apos;enregistrement de référence. Les voix livrées sont des voix de synthèse : enregistre une vraie personne (toi, un proche ; il faut une voix de femme pour Emma). Pièce calme, téléphone à 20 cm, parle comme dans une conversation, 10 à 15 secondes, sans musique.
      </p>
      <div className="grid grid-cols-2 gap-2">
        <label className="flex flex-col gap-1 text-xs text-muted">
          Personnage
          <select value={voice} onChange={(e) => setVoice(e.target.value)} className="h-11 rounded-xl border border-line bg-bg px-3 text-base text-fg">
            {VOICE_CHOICES.map((v) => (
              <option key={v.key} value={v.key}>
                {v.label}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-xs text-muted">
          Langue
          <select value={language} onChange={(e) => setLanguage(e.target.value as Language)} className="h-11 rounded-xl border border-line bg-bg px-3 text-base text-fg">
            {(["fr", "en"] as Language[]).map((l) => (
              <option key={l} value={l}>
                {LANGUAGE_LABELS[l]}
              </option>
            ))}
          </select>
        </label>
      </div>
      <p className="rounded-xl bg-bg px-3 py-2 text-sm leading-snug">{SCRIPTS[language]}</p>
      {!supported ? (
        <p className="text-sm text-danger">Ce navigateur ne sait pas enregistrer. Essaie avec Chrome.</p>
      ) : status === "recording" ? (
        <button type="button" onClick={stop} className="h-12 rounded-2xl bg-danger text-sm font-bold text-accent-contrast">
          Arrêter ({seconds} s / {MAX_SECONDS})
        </button>
      ) : (
        <button type="button" onClick={start} disabled={status === "sending"} className="h-12 rounded-2xl bg-accent text-sm font-bold text-accent-contrast disabled:opacity-60">
          {blob ? "Réenregistrer" : "Enregistrer"}
        </button>
      )}
      {previewUrl && (
        <>
          <audio controls src={previewUrl} className="w-full" aria-label="Réécouter l'enregistrement" />
          <button type="button" onClick={send} disabled={status === "sending" || status === "sent"} className="h-12 rounded-2xl border border-line bg-bg text-sm font-bold disabled:opacity-60">
            {status === "sending" ? "Envoi au PC…" : status === "sent" ? "Envoyée" : `Envoyer au PC comme voix « ${VOICE_CHOICES.find((v) => v.key === voice)?.label ?? voice} » (${LANGUAGE_LABELS[language].toLowerCase()})`}
          </button>
        </>
      )}
      {message && <p className={`text-sm ${status === "error" ? "text-danger" : "text-speaking"}`}>{message}</p>}
    </section>
  );
}
