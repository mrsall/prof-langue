import { db, dbAvailable, withTimeout } from "@/lib/db";

/**
 * Frein sur le code d'accès : 5 essais faux par adresse IP, 15 essais faux
 * au total (toutes adresses), puis 15 minutes de blocage. Le compteur vit dans
 * la base (`acces_tentatives`) pour survivre aux fonctions serverless ; sans
 * base, une mémoire du serveur fait l'appoint.
 */
export const WINDOW_MS = 15 * 60 * 1000;
export const MAX_PER_IP = 5;
export const MAX_GLOBAL = 15;

type Attempt = { ip: string; at: number };
const memory: Attempt[] = [];

export type LimitState = {
  /** Essais faux récents depuis cette adresse. */
  byIp: number;
  /** Essais faux récents, toutes adresses. */
  total: number;
  /** Minutes restantes de blocage (0 = pas bloqué). */
  blockedMinutes: number;
};

function minutesLeft(oldest: number | null) {
  if (oldest == null) return 0;
  return Math.max(1, Math.ceil((oldest + WINDOW_MS - Date.now()) / 60000));
}

function fromMemory(ip: string): LimitState {
  const since = Date.now() - WINDOW_MS;
  while (memory.length && memory[0].at < since) memory.shift();
  const mine = memory.filter((a) => a.ip === ip);
  const byIp = mine.length;
  const total = memory.length;
  const blockedMinutes = byIp >= MAX_PER_IP ? minutesLeft(mine[0].at) : total >= MAX_GLOBAL ? minutesLeft(memory[0].at) : 0;
  return { byIp, total, blockedMinutes };
}

export async function accessLimit(ip: string): Promise<LimitState> {
  if (!dbAvailable()) return fromMemory(ip);
  try {
    const sql = await withTimeout(db(), 4000);
    if (!sql) return fromMemory(ip);
    const [row] = await withTimeout(
      sql<{ by_ip: number; total: number; oldest_ip: string | null; oldest: string | null }[]>`select
        count(*) filter (where ip = ${ip})::int as by_ip,
        count(*)::int as total,
        min(at) filter (where ip = ${ip}) as oldest_ip,
        min(at) as oldest
        from acces_tentatives where at > now() - interval '15 minutes'`,
      4000,
    );
    const byIp = row?.by_ip ?? 0;
    const total = row?.total ?? 0;
    const blockedMinutes =
      byIp >= MAX_PER_IP ? minutesLeft(row?.oldest_ip ? new Date(row.oldest_ip).getTime() : null) : total >= MAX_GLOBAL ? minutesLeft(row?.oldest ? new Date(row.oldest).getTime() : null) : 0;
    return { byIp, total, blockedMinutes };
  } catch (error) {
    console.error("Frein du code d'accès : base indisponible, mémoire du serveur utilisée", error);
    return fromMemory(ip);
  }
}

export async function recordFailedAttempt(ip: string): Promise<void> {
  memory.push({ ip, at: Date.now() });
  if (!dbAvailable()) return;
  try {
    const sql = await withTimeout(db(), 4000);
    if (!sql) return;
    await withTimeout(sql`insert into acces_tentatives (ip) values (${ip})`, 4000);
    // Ménage : on ne garde qu'une journée d'historique.
    if (Math.random() < 0.1) await withTimeout(sql`delete from acces_tentatives where at < now() - interval '1 day'`, 4000);
  } catch (error) {
    console.error("Frein du code d'accès : essai non enregistré en base", error);
  }
}

/** Adresse du téléphone telle que Vercel la transmet. */
export function clientIp(request: Request): string {
  const forwarded = request.headers.get("x-forwarded-for");
  if (forwarded) return forwarded.split(",")[0].trim().slice(0, 64) || "inconnue";
  return request.headers.get("x-real-ip")?.slice(0, 64) || "inconnue";
}
