import webpush from "web-push";
import { getSetting, setSetting } from "@/lib/db";

/**
 * Notifications push : les clés VAPID sont créées une fois et gardées en base,
 * l'abonnement du téléphone aussi. Rien à configurer côté Vercel.
 */
type Vapid = { publicKey: string; privateKey: string };

export async function getVapid(): Promise<Vapid | null> {
  const existing = await getSetting<Vapid | null>("vapid", null);
  if (existing?.publicKey && existing.privateKey) return existing;
  const keys = webpush.generateVAPIDKeys();
  const saved = await setSetting("vapid", keys);
  return saved ? keys : null;
}

export type StoredSubscription = { endpoint: string; keys: { p256dh: string; auth: string } };

export async function getSubscription() {
  return getSetting<StoredSubscription | null>("push", null);
}

export async function sendPush(payload: { title: string; body: string; url?: string }) {
  const [vapid, sub] = await Promise.all([getVapid(), getSubscription()]);
  if (!vapid || !sub) return { sent: false, reason: "pas d'abonnement" };
  webpush.setVapidDetails(process.env.VAPID_SUBJECT || "mailto:prof-langue@example.com", vapid.publicKey, vapid.privateKey);
  try {
    await webpush.sendNotification(sub, JSON.stringify(payload));
    return { sent: true };
  } catch (error) {
    const status = (error as { statusCode?: number }).statusCode;
    if (status === 404 || status === 410) {
      await setSetting("push", null);
      return { sent: false, reason: "abonnement expiré" };
    }
    console.error("Push", error);
    return { sent: false, reason: `erreur ${status ?? ""}`.trim() };
  }
}
