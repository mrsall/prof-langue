import { connection } from "next/server";
import { dbAvailable, setSetting } from "@/lib/db";
import { getReminder } from "@/lib/settings";
import { sendPush } from "@/lib/push";
import { PERSONALITIES, type Language } from "@/config/personalities";
import { randomTopic } from "@/config/topics";

export const maxDuration = 30;

/**
 * Appelée par le cron Vercel (vercel.json) une fois par jour, ou à la main
 * avec ?force=1 depuis la page Réglages. Envoie le rappel du jour avec un
 * sujet, si l'heure choisie est passée et que rien n'a été envoyé aujourd'hui.
 */
export async function GET(request: Request) {
  await connection();
  const url = new URL(request.url);
  const force = url.searchParams.get("force") === "1";
  const secret = process.env.CRON_SECRET;
  const auth = request.headers.get("authorization");
  if (secret && !force && auth !== `Bearer ${secret}`) {
    return Response.json({ error: "Non autorisé." }, { status: 401 });
  }
  if (!dbAvailable()) return Response.json({ sent: false, reason: "pas de base de données" });

  const reminder = await getReminder();
  const now = new Date();
  const dakarHour = now.getUTCHours(); // Dakar est à l'heure UTC toute l'année
  const today = now.toISOString().slice(0, 10);
  if (!force) {
    if (!reminder.enabled) return Response.json({ sent: false, reason: "rappels désactivés" });
    if (dakarHour < reminder.hour) return Response.json({ sent: false, reason: `pas encore l'heure (${reminder.hour} h)` });
    if (reminder.lastSentDay === today) return Response.json({ sent: false, reason: "déjà envoyé aujourd'hui" });
  }

  const personality = PERSONALITIES[now.getUTCDate() % PERSONALITIES.length];
  const language: Language = now.getUTCDate() % 3 === 0 ? "fr" : "en";
  const topic = randomTopic(personality.id, language);
  const name = personality.id === "situation" ? "une mise en situation" : personality.name;
  const result = await sendPush({
    title: "C'est l'heure de parler !",
    body: `Sujet du jour avec ${name} : ${topic}. 10 minutes suffisent.`,
    url: "/",
  });
  if (result.sent && !force) await setSetting("reminder", { ...reminder, lastSentDay: today });
  return Response.json({ ...result, topic, personality: personality.id, language });
}
