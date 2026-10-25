import postgres from "postgres";

/**
 * Base de données (Postgres, par exemple Supabase). Le schéma est créé tout
 * seul au premier accès. Sans DATABASE_URL, `db()` renvoie null et l'app
 * continue avec le stockage du téléphone.
 */
type Sql = ReturnType<typeof postgres>;

const globalForDb = globalThis as unknown as { __profLangueSql?: Sql; __profLangueSchema?: Promise<void> };

export function dbAvailable() {
  return Boolean(process.env.DATABASE_URL);
}

export async function db(): Promise<Sql | null> {
  const url = process.env.DATABASE_URL;
  if (!url) return null;
  if (!globalForDb.__profLangueSql) {
    globalForDb.__profLangueSql = postgres(url, {
      ssl: url.includes("localhost") ? undefined : "require",
      max: 1,
      prepare: false, // compatible avec le pooler Supabase en mode transaction
      idle_timeout: 20,
      connect_timeout: 10,
    });
  }
  const sql = globalForDb.__profLangueSql;
  if (!globalForDb.__profLangueSchema) {
    globalForDb.__profLangueSchema = ensureSchema(sql).catch((error) => {
      globalForDb.__profLangueSchema = undefined;
      throw error;
    });
  }
  await globalForDb.__profLangueSchema;
  return sql;
}

async function ensureSchema(sql: Sql) {
  await sql`create table if not exists settings (
    key text primary key,
    value jsonb not null,
    updated_at timestamptz not null default now()
  )`;
  await sql`create table if not exists sessions (
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
  )`;
  await sql`create table if not exists words (
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
  )`;
  await sql`create unique index if not exists words_language_word_idx on words (language, lower(word))`;
  await sql`create table if not exists errors (
    id bigserial primary key,
    session_id bigint,
    language text not null,
    wrong text not null,
    "right" text not null,
    tip text,
    created_at timestamptz not null default now()
  )`;
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

/** Erreur lisible pour Cherif quand la base ne répond pas. */
export function dbErrorMessage(error: unknown) {
  console.error("Base de données", error);
  return "La base de données ne répond pas. Vérifie DATABASE_URL dans Vercel (voir Réglages).";
}
