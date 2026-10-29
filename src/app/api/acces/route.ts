import { createHash, timingSafeEqual } from "node:crypto";
import { accessCookieName, accessCookieValue } from "@/lib/access";
import { accessLimit, clientIp, MAX_PER_IP, recordFailedAttempt } from "@/lib/access-limit";

/**
 * Code d'accès (variable APP_PIN) : protège les minutes ElevenLabs de Cherif.
 * Le téléphone garde un cookie un an après avoir saisi le code.
 * Frein : 5 essais faux par adresse (15 au total), puis 15 min de blocage,
 * pendant lesquelles même le bon code est refusé (429).
 */
export async function POST(request: Request) {
  const pin = process.env.APP_PIN;
  if (!pin) return Response.json({ ok: true });
  const ip = clientIp(request);
  const before = await accessLimit(ip);
  if (before.blockedMinutes > 0) return blocked(before.blockedMinutes);
  let code = "";
  try {
    const body = (await request.json()) as { code?: string };
    code = String(body.code ?? "").trim();
  } catch {
    // vide
  }
  if (!sameSecret(code, pin)) {
    await recordFailedAttempt(ip);
    // 5 essais faux passent en 401 ; le 6e (et le bon code) tombent en 429 pendant 15 min.
    const left = Math.max(0, MAX_PER_IP - (before.byIp + 1));
    await new Promise((r) => setTimeout(r, 800));
    return Response.json(
      { ok: false, error: left > 0 ? `Code incorrect. Encore ${left} essai${left > 1 ? "s" : ""} avant un blocage de 15 min.` : "Code incorrect. Au prochain essai faux, blocage de 15 min." },
      { status: 401 },
    );
  }
  const value = await accessCookieValue(pin);
  const headers = new Headers({ "Content-Type": "application/json" });
  headers.append(
    "Set-Cookie",
    `${accessCookieName}=${value}; Path=/; Max-Age=${60 * 60 * 24 * 365}; HttpOnly; SameSite=Lax; Secure`,
  );
  return new Response(JSON.stringify({ ok: true }), { headers });
}

function blocked(minutes: number) {
  return Response.json(
    { ok: false, blocked: true, retryAfterMinutes: minutes, error: `Trop d'essais, réessaie dans ${minutes} min.` },
    { status: 429, headers: { "Retry-After": String(minutes * 60) } },
  );
}

/** Comparaison en temps constant (empreintes de même longueur). */
function sameSecret(given: string, expected: string) {
  const a = createHash("sha256").update(given).digest();
  const b = createHash("sha256").update(expected).digest();
  return timingSafeEqual(a, b);
}
