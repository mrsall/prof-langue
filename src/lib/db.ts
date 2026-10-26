import postgres from "postgres";

/**
 * Base de données (Postgres, par exemple Supabase). Le schéma est créé tout
 * seul au premier accès. Sans DATABASE_URL, `db()` renvoie null et l'app
 * continue avec le stockage du téléphone.
 */
type Sql = ReturnType<typeof postgres>;

const globalForDb = globalThis as unknown as {
  __profLangueSql?: Sql;
  __profLangueSchema?: Promise<void>;
  __profLangueFailure?: { at: number; error: unknown };
};

/** Après un échec de connexion, on n'essaie plus pendant ce délai : l'app reste rapide. */
const BREAKER_MS = 60_000;

/** Attend au plus `ms` millisecondes, sinon lève une erreur CONNECT_TIMEOUT. */
export function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(Object.assign(new Error(`pas de réponse en ${ms} ms`), { code: "CONNECT_TIMEOUT" })), ms);
    promise.then(
      (v) => {
        clearTimeout(timer);
        resolve(v);
      },
      (e) => {
        clearTimeout(timer);
        reject(e);
      },
    );
  });
}

export function dbAvailable() {
  return Boolean(process.env.DATABASE_URL);
}

/**
 * Nettoie la chaîne de connexion collée depuis Supabase : espaces, mot de passe
 * avec caractères spéciaux non encodés (#, @, %, /…), crochets oubliés.
 */
export function normalizeDatabaseUrl(raw: string) {
  let url = raw.trim().replace(/^["']|["']$/g, "");
  const m = url.match(/^(postgres(?:ql)?:\/\/)([^:\/@]+):(.*)@([^@]+)$/);
  if (m) {
    const [, scheme, user, password, rest] = m;
    let decoded = password;
    try {
      decoded = decodeURIComponent(password);
    } catch {
      decoded = password;
    }
    url = `${scheme}${user}:${encodeURIComponent(decoded)}@${rest}`;
  }
  return url;
}

export async function db(): Promise<Sql | null> {
  const rawUrl = process.env.DATABASE_URL;
  if (!rawUrl) return null;
  const failure = globalForDb.__profLangueFailure;
  if (failure && Date.now() - failure.at < BREAKER_MS) {
    // Dernier essai raté il y a moins d'une minute : on ne refait pas attendre.
    throw failure.error;
  }
  const url = normalizeDatabaseUrl(rawUrl);
  if (!globalForDb.__profLangueSql) {
    globalForDb.__profLangueSql = postgres(url, {
      ssl: url.includes("localhost") ? undefined : "require",
      max: 1,
      prepare: false, // compatible avec le pooler Supabase en mode transaction
      idle_timeout: 20,
      connect_timeout: 8,
    });
  }
  const sql = globalForDb.__profLangueSql;
  if (!globalForDb.__profLangueSchema) {
    globalForDb.__profLangueSchema = withTimeout(ensureSchema(sql, url), 15000).catch((error) => {
      globalForDb.__profLangueSchema = undefined;
      globalForDb.__profLangueFailure = { at: Date.now(), error };
      throw error;
    });
  }
  await globalForDb.__profLangueSchema;
  globalForDb.__profLangueFailure = undefined;
  return sql;
}

/** Oublie le dernier échec (pour réessayer tout de suite, par exemple après un réglage). */
export function resetDbBreaker() {
  globalForDb.__profLangueFailure = undefined;
}

/**
 * Une commande par élément du schéma. Elles sont envoyées une par une : le
 * pooler Supabase en mode transaction gère mal plusieurs commandes dans un
 * même message, et laissait ensuite la connexion bloquée (toutes les requêtes
 * suivantes attendaient sans fin, d'où « Serveur injoignable »).
 */
const SCHEMA_STATEMENTS = [
  `create table if not exists settings (
  key text primary key,
  value jsonb not null,
  updated_at timestamptz not null default now()
)`,
  `create table if not exists sessions (
  id bigserial primary key,
  started_at timestamptz not null default now(),
  kind text not null default 'conversation',
  language text not null,
  personality text not null,
  topic text,
  seconds integer not null default 0,
  user_turns integer not null default 0,
  user_share integer not null default 0,
  transcript jsonb,
  corrections jsonb,
  errors jsonb,
  words jsonb,
  encouragement text,
  level text,
  cost_fcfa numeric not null default 0
)`,
  `create table if not exists words (
  id bigserial primary key,
  language text not null,
  word text not null,
  translation text,
  session_id bigint,
  created_at timestamptz not null default now(),
  due_at timestamptz not null default now() + interval '1 day',
  stage integer not null default 0,
  reviews integer not null default 0,
  lapses integer not null default 0
)`,
  `create unique index if not exists words_language_word_idx on words (language, lower(word))`,
  `create table if not exists errors (
  id bigserial primary key,
  session_id bigint,
  language text not null,
  wrong text not null,
  "right" text not null,
  tip text,
  created_at timestamptz not null default now()
)`,
  `create table if not exists pron_attempts (
  id bigserial primary key,
  created_at timestamptz not null default now(),
  language text not null,
  reference text not null,
  recognized text,
  pron_score integer not null default 0,
  accuracy integer not null default 0,
  fluency integer not null default 0,
  completeness integer not null default 0,
  words jsonb
)`,
  `create table if not exists pron_sounds (
  language text not null,
  phoneme text not null,
  attempts integer not null default 0,
  fails integer not null default 0,
  score_sum integer not null default 0,
  updated_at timestamptz not null default now(),
  primary key (language, phoneme)
)`,
];

/**
 * Vérifie le schéma sans jamais risquer de bloquer la connexion de l'app :
 * 1. une seule requête simple dit si tout existe déjà (cas normal : rien à faire) ;
 * 2. sinon, les commandes passent une par une sur une connexion jetable,
 *    fermée juste après, et la connexion principale reste intacte.
 */
async function ensureSchema(sql: Sql, url: string) {
  const [row] = await sql<{ ok: boolean }[]>`select
    to_regclass('public.settings') is not null
    and to_regclass('public.sessions') is not null
    and to_regclass('public.words') is not null
    and to_regclass('public.words_language_word_idx') is not null
    and to_regclass('public.errors') is not null as ok`;
  if (row?.ok) return;

  const setup = postgres(url, {
    ssl: url.includes("localhost") ? undefined : "require",
    max: 1,
    prepare: false,
    idle_timeout: 2,
    connect_timeout: 8,
    onnotice: () => undefined, // « existe déjà » n'est pas une erreur
  });
  try {
    for (const statement of SCHEMA_STATEMENTS) {
      await setup.unsafe(statement);
    }
  } finally {
    await setup.end({ timeout: 2 }).catch(() => undefined);
  }
}

export async function getSetting<T>(key: string, fallback: T): Promise<T> {
  const sql = await db();
  if (!sql) return fallback;
  const rows = await sql<{ value: T }[]>`select value from settings where key = ${key}`;
  return rows[0]?.value ?? fallback;
}

export async function setSetting(key: string, value: unknown) {
  const sql = await db();
  if (!sql) return false;
  await sql`insert into settings (key, value, updated_at) values (${key}, ${sql.json(value as never)}, now())
    on conflict (key) do update set value = excluded.value, updated_at = now()`;
  return true;
}

/** Erreur lisible pour Cherif quand la base ne répond pas, avec la cause probable. */
export function dbErrorMessage(error: unknown) {
  console.error("Base de données", error);
  const e = error as { code?: string; message?: string; errno?: string } | undefined;
  const code = String(e?.code ?? e?.errno ?? "");
  const msg = String(e?.message ?? "").toLowerCase();
  const url = process.env.DATABASE_URL ?? "";
  const hint = (() => {
    if (url.includes("[YOUR-PASSWORD]") || url.includes("YOUR-PASSWORD")) {
      return "La chaîne contient encore [YOUR-PASSWORD] : remplace-le par le mot de passe de la base (sans les crochets).";
    }
    if (code === "28P01" || msg.includes("password authentication failed")) {
      return "Mot de passe refusé. Dans Supabase → Project Settings → Database → Reset database password, génère un nouveau mot de passe, puis mets à jour DATABASE_URL dans Vercel.";
    }
    if (msg.includes("tenant or user not found")) {
      return "Nom d'utilisateur incomplet pour le pooler : il doit ressembler à postgres.xxxxxxxx (copie la chaîne de l'onglet Transaction pooler sans la modifier).";
    }
    if (code === "ENOTFOUND" || code === "EAI_AGAIN") {
      return "Adresse du serveur introuvable : la chaîne est sans doute incomplète ou mal copiée.";
    }
    if (code === "ENETUNREACH" || code === "ECONNREFUSED" || code === "ETIMEDOUT" || code === "CONNECT_TIMEOUT" || msg.includes("timeout")) {
      return "Serveur injoignable. Utilise la chaîne de l'onglet Transaction pooler (port 6543), pas la connexion directe (port 5432), qui n'est pas accessible depuis Vercel.";
    }
    if (msg.includes("ssl") || msg.includes("certificate")) {
      return "Problème de connexion sécurisée (SSL). Réessaie dans un instant ; si ça continue, envoie-moi une capture.";
    }
    if (msg.includes("too many") || msg.includes("max client")) {
      return "Trop de connexions ouvertes. Utilise l'onglet Transaction pooler (port 6543).";
    }
    return `Détail technique : ${code || msg.slice(0, 80) || "inconnu"}.`;
  })();
  return `La base de données ne répond pas. ${hint}`;
}
