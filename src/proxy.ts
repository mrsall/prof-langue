import { NextResponse, type NextRequest } from "next/server";
import { accessCookieName, accessCookieValue } from "@/lib/access";

/**
 * Si APP_PIN est défini, toute l'app demande le code d'accès une fois par
 * appareil. Les fichiers publics, la page du code et le cron restent ouverts.
 */
export async function proxy(request: NextRequest) {
  const pin = process.env.APP_PIN;
  if (!pin) return NextResponse.next();
  const { pathname } = request.nextUrl;
  if (
    pathname === "/acces" ||
    pathname === "/api/acces" ||
    pathname === "/api/rappels/envoyer" ||
    pathname === "/sw.js" ||
    pathname === "/manifest.webmanifest" ||
    pathname.startsWith("/icon") ||
    pathname.startsWith("/apple-icon") ||
    pathname === "/favicon.ico"
  ) {
    return NextResponse.next();
  }
  const expected = await accessCookieValue(pin);
  if (request.cookies.get(accessCookieName)?.value === expected) return NextResponse.next();
  if (pathname.startsWith("/api/")) {
    return NextResponse.json({ error: "Code d'accès requis." }, { status: 401 });
  }
  const url = request.nextUrl.clone();
  url.pathname = "/acces";
  url.search = "";
  return NextResponse.redirect(url);
}

export const config = {
  matcher: ["/((?!_next/static|_next/image).*)"],
};
