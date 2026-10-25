/**
 * Code d'accès : on ne stocke jamais le code lui-même dans le cookie, mais
 * une empreinte (SHA-256). Fonctionne dans le proxy comme dans les routes.
 */
export const accessCookieName = "pl_acces";

export async function accessCookieValue(pin: string) {
  const data = new TextEncoder().encode(`prof-langue:${pin}`);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}
