import { accessCookieName, accessCookieValue } from "@/lib/access";

/**
 * Code d'accès (variable APP_PIN) : protège les minutes ElevenLabs de Cherif.
 * Le téléphone garde un cookie un an après avoir saisi le code.
 */
export async function POST(request: Request) {
  const pin = process.env.APP_PIN;
  if (!pin) return Response.json({ ok: true });
  let code = "";
  try {
    const body = (await request.json()) as { code?: string };
    code = String(body.code ?? "").trim();
  } catch {
    // vide
  }
  if (code !== pin) {
    await new Promise((r) => setTimeout(r, 800));
    return Response.json({ ok: false, error: "Code incorrect." }, { status: 401 });
  }
  const value = await accessCookieValue(pin);
  const headers = new Headers({ "Content-Type": "application/json" });
  headers.append(
    "Set-Cookie",
    `${accessCookieName}=${value}; Path=/; Max-Age=${60 * 60 * 24 * 365}; HttpOnly; SameSite=Lax; Secure`,
  );
  return new Response(JSON.stringify({ ok: true }), { headers });
}
