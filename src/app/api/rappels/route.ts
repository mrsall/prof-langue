import { connection } from "next/server";
import { dbAvailable, dbErrorMessage, setSetting } from "@/lib/db";
import { getVapid, getSubscription, sendPush, type StoredSubscription } from "@/lib/push";

/**
 * Abonnement aux rappels : GET clé publique + état, POST enregistre
 * l'abonnement du téléphone (et envoie une notification de test), DELETE le retire.
 */
export async function GET() {
  await connection();
  if (!dbAvailable()) return Response.json({ db: false, publicKey: null, subscribed: false });
  try {
    const [vapid, sub] = await Promise.all([getVapid(), getSubscription()]);
    return Response.json({ db: true, publicKey: vapid?.publicKey ?? null, subscribed: Boolean(sub) });
  } catch (error) {
    return Response.json({ db: true, publicKey: null, subscribed: false, error: dbErrorMessage(error) }, { status: 502 });
  }
}

export async function POST(request: Request) {
  if (!dbAvailable()) return Response.json({ error: "Base de données non configurée." }, { status: 400 });
  let sub: StoredSubscription | null = null;
  try {
    sub = (await request.json()) as StoredSubscription;
  } catch {
    // vide
  }
  if (!sub?.endpoint || !sub.keys?.p256dh || !sub.keys?.auth) {
    return Response.json({ error: "Abonnement incomplet." }, { status: 400 });
  }
  try {
    await setSetting("push", { endpoint: sub.endpoint, keys: { p256dh: sub.keys.p256dh, auth: sub.keys.auth } });
    const test = await sendPush({ title: "Prof de langues", body: "Les rappels sont activés. À demain pour ta séance !", url: "/" });
    return Response.json({ ok: true, test });
  } catch (error) {
    return Response.json({ error: dbErrorMessage(error) }, { status: 502 });
  }
}

export async function DELETE() {
  if (!dbAvailable()) return Response.json({ ok: true });
  try {
    await setSetting("push", null);
    return Response.json({ ok: true });
  } catch (error) {
    return Response.json({ error: dbErrorMessage(error) }, { status: 502 });
  }
}
