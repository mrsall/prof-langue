import { connection } from "next/server";

export const maxDuration = 60;
import dns from "node:dns/promises";
import net from "node:net";
import tls from "node:tls";
import postgres from "postgres";
import { db, normalizeDatabaseUrl, resetDbBreaker, withTimeout } from "@/lib/db";

/**
 * Diagnostic pas à pas de la base de données : résolution du nom, connexion
 * TCP, poignée de main TLS, authentification Postgres. Aucun secret renvoyé.
 */
type Step = { name: string; ok: boolean; detail: string; ms: number };

async function timed<T>(fn: () => Promise<T>): Promise<{ value?: T; error?: unknown; ms: number }> {
  const start = Date.now();
  try {
    const value = await fn();
    return { value, ms: Date.now() - start };
  } catch (error) {
    return { error, ms: Date.now() - start };
  }
}

function errText(e: unknown) {
  const err = e as { code?: string; message?: string } | undefined;
  return `${err?.code ?? ""} ${err?.message ?? String(e)}`.trim().slice(0, 160);
}

export async function GET() {
  await connection();
  resetDbBreaker();
  const raw = process.env.DATABASE_URL;
  const steps: Step[] = [];
  if (!raw) return Response.json({ steps: [{ name: "Variable DATABASE_URL", ok: false, detail: "absente", ms: 0 }] });

  let url: URL;
  try {
    url = new URL(normalizeDatabaseUrl(raw));
  } catch {
    return Response.json({ steps: [{ name: "Lecture de la chaîne", ok: false, detail: "chaîne illisible", ms: 0 }] });
  }
  const host = url.hostname;
  const port = Number(url.port || 5432);

  const dnsRes = await timed(() => dns.lookup(host, { all: true }));
  steps.push({
    name: "Nom de domaine",
    ok: !dnsRes.error,
    detail: dnsRes.error ? errText(dnsRes.error) : (dnsRes.value ?? []).map((a) => `${a.address} (IPv${a.family})`).join(", "),
    ms: dnsRes.ms,
  });
  if (dnsRes.error) return Response.json({ steps });

  const tcpRes = await timed(
    () =>
      new Promise<string>((resolve, reject) => {
        const socket = net.connect({ host, port, family: 4 });
        const timer = setTimeout(() => {
          socket.destroy();
          reject(new Error(`pas de réponse en 8 s sur le port ${port}`));
        }, 8000);
        socket.once("connect", () => {
          clearTimeout(timer);
          const local = socket.remoteAddress ?? "";
          socket.destroy();
          resolve(`connecté à ${local}:${port}`);
        });
        socket.once("error", (e) => {
          clearTimeout(timer);
          reject(e);
        });
      }),
  );
  steps.push({ name: "Connexion réseau (TCP)", ok: !tcpRes.error, detail: tcpRes.error ? errText(tcpRes.error) : (tcpRes.value ?? ""), ms: tcpRes.ms });
  if (tcpRes.error) return Response.json({ steps });

  const tlsRes = await timed(
    () =>
      new Promise<string>((resolve, reject) => {
        // Postgres négocie TLS après un message SSLRequest ; on vérifie ici
        // seulement que le serveur répond au protocole Postgres.
        const socket = net.connect({ host, port, family: 4 });
        const timer = setTimeout(() => {
          socket.destroy();
          reject(new Error("pas de réponse au protocole Postgres en 8 s"));
        }, 8000);
        socket.once("connect", () => {
          socket.write(Buffer.from([0, 0, 0, 8, 4, 210, 22, 47]));
        });
        socket.once("data", (buf) => {
          clearTimeout(timer);
          const answer = buf.toString("latin1", 0, 1);
          if (answer === "S") {
            const secure = tls.connect({ socket, servername: host, rejectUnauthorized: false });
            secure.once("secureConnect", () => {
              const cert = secure.getPeerCertificate();
              secure.destroy();
              resolve(`TLS ok, certificat ${cert?.subject?.CN ?? "?"}`);
            });
            secure.once("error", (e) => reject(e));
          } else {
            socket.destroy();
            resolve(`le serveur répond mais refuse TLS (${answer})`);
          }
        });
        socket.once("error", (e) => {
          clearTimeout(timer);
          reject(e);
        });
      }),
  );
  steps.push({ name: "Sécurisation (TLS)", ok: !tlsRes.error, detail: tlsRes.error ? errText(tlsRes.error) : (tlsRes.value ?? ""), ms: tlsRes.ms });

  const sql = postgres(url.toString(), { ssl: "require", max: 1, prepare: false, connect_timeout: 8, idle_timeout: 2 });
  const pgRes = await timed(async () => {
    const rows = await sql<{ now: string; version: string }[]>`select now()::text as now, version() as version`;
    return rows[0]?.version?.split(" on ")[0] ?? "ok";
  });
  await sql.end({ timeout: 2 }).catch(() => undefined);
  steps.push({ name: "Authentification Postgres", ok: !pgRes.error, detail: pgRes.error ? errText(pgRes.error) : (pgRes.value ?? ""), ms: pgRes.ms });
  if (pgRes.error) return Response.json({ steps, host, port, region: process.env.VERCEL_REGION ?? null });

  // 5. Le chemin réel de l'app : connexion partagée + création/contrôle des tables.
  const schemaRes = await timed(async () => {
    const shared = await withTimeout(db(), 25000);
    if (!shared) throw new Error("DATABASE_URL absente");
    const tables = await shared<{ n: number }[]>`select count(*)::int as n from information_schema.tables
      where table_schema = 'public' and table_name in ('settings', 'sessions', 'words', 'errors', 'pron_attempts', 'pron_sounds')`;
    return `${tables[0]?.n ?? 0} tables sur 6`;
  });
  steps.push({ name: "Tables de l'app", ok: !schemaRes.error && schemaRes.value === "6 tables sur 6", detail: schemaRes.error ? errText(schemaRes.error) : (schemaRes.value ?? ""), ms: schemaRes.ms });
  if (schemaRes.error) return Response.json({ steps, host, port, region: process.env.VERCEL_REGION ?? null });

  // 6. Les requêtes de l'écran Suivi, une par une, avec leur durée.
  const suiviRes = await timed(async () => {
    const shared = (await db())!;
    const t0 = Date.now();
    const sessions = await shared<{ n: number }[]>`select count(*)::int as n from sessions`;
    const t1 = Date.now();
    const words = await shared<{ n: number }[]>`select count(*)::int as n from words`;
    const t2 = Date.now();
    const pron = await shared<{ n: number }[]>`select count(*)::int as n from pron_attempts`;
    const t3 = Date.now();
    const weeks = await shared<{ start: string }[]>`select to_char(date_trunc('week', started_at at time zone 'Africa/Dakar'), 'YYYY-MM-DD') as start
      from sessions where started_at > now() - interval '8 weeks' group by 1 order by 1`;
    const t4 = Date.now();
    return `${sessions[0]?.n ?? 0} séances (${t1 - t0} ms), ${words[0]?.n ?? 0} mots (${t2 - t1} ms), ${pron[0]?.n ?? 0} phrases notées (${t3 - t2} ms), ${weeks.length} semaines (${t4 - t3} ms)`;
  });
  steps.push({ name: "Requêtes du suivi", ok: !suiviRes.error, detail: suiviRes.error ? errText(suiviRes.error) : (suiviRes.value ?? ""), ms: suiviRes.ms });

  return Response.json({ steps, host, port, region: process.env.VERCEL_REGION ?? null });
}
