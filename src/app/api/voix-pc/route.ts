import { connection } from "next/server";
import { isLanguage } from "@/config/personalities";
import { pcAvailable, pcUploadVoice } from "@/lib/pc-tts";

export const maxDuration = 60;

/**
 * B1 : Admin → « Enregistrer une voix ». Le téléphone envoie son enregistrement
 * (webm/opus, mp4 ou wav), Vercel le transmet au PC qui l'installe comme voix de
 * référence `voix/<personnage>.<langue>.wav`. L'audio n'est pas conservé ici.
 */
export async function POST(request: Request) {
  await connection();
  if (!pcAvailable()) return Response.json({ ok: false, error: "PC non configuré (PC_TTS_URL et PC_TTS_TOKEN dans Vercel)." }, { status: 503 });
  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return Response.json({ ok: false, error: "Envoi illisible." }, { status: 400 });
  }
  const audio = form.get("audio");
  const voice = String(form.get("voice") ?? "").toLowerCase();
  const langRaw = String(form.get("language") ?? "fr");
  const language = isLanguage(langRaw) ? langRaw : "fr";
  if (!(audio instanceof Blob) || audio.size < 5000) return Response.json({ ok: false, error: "Enregistrement vide ou trop court (parle au moins 3 secondes)." }, { status: 400 });
  if (!/^[a-z-]{2,20}$/.test(voice)) return Response.json({ ok: false, error: "Personnage inconnu." }, { status: 400 });
  try {
    const name = audio instanceof File && audio.name ? audio.name : `voix.${audio.type.includes("mp4") ? "mp4" : audio.type.includes("wav") ? "wav" : "webm"}`;
    const result = await pcUploadVoice(audio, name, voice, language);
    return Response.json(result);
  } catch (error) {
    return Response.json({ ok: false, error: error instanceof Error ? error.message : String(error) }, { status: 502 });
  }
}
