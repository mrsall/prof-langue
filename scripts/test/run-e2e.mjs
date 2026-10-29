#!/usr/bin/env node
/**
 * Lance tout le banc de test : serveur factice (Claude + ElevenLabs), l'app
 * construite en mode production, puis le parcours Playwright. À utiliser
 * avant chaque livraison :
 *   DATABASE_URL=postgres://... node scripts/test/run-e2e.mjs
 * (sans DATABASE_URL, l'app tourne en mode téléphone seul.)
 */
import { spawn } from "node:child_process";

const MOCK_PORT = 4545;
const APP_PORT = Number(process.env.APP_PORT || 3300);
const children = [];

function run(cmd, args, env, label) {
  const child = spawn(cmd, args, { env: { ...process.env, ...env }, stdio: ["ignore", "pipe", "pipe"] });
  child.stdout.on("data", (d) => process.env.E2E_VERBOSE && process.stdout.write(`[${label}] ${d}`));
  child.stderr.on("data", (d) => process.stdout.write(`[${label}] ${d}`));
  children.push(child);
  return child;
}

async function waitFor(url, ms) {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(url);
      if (res.ok || res.status === 503 || res.status === 401) return; // 401 = code d'accès actif, l'app répond
    } catch {
      // pas encore prêt
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`${url} ne répond pas`);
}

function stopAll() {
  for (const c of children) {
    try {
      c.kill("SIGTERM");
    } catch {
      // déjà arrêté
    }
  }
}

const env = {
  ANTHROPIC_API_KEY: "test",
  ANTHROPIC_BASE_URL: `http://localhost:${MOCK_PORT}`,
  ELEVENLABS_API_KEY: "test",
  ELEVENLABS_AGENT_ID: "test",
  ELEVENLABS_API_BASE: `http://localhost:${MOCK_PORT}`,
  GEMINI_API_KEY: "test",
  GEMINI_API_BASE: `http://localhost:${MOCK_PORT}`,
  GROQ_API_KEY: "test",
  PC_TTS_URL: `http://localhost:${MOCK_PORT}/pc`,
  PC_TTS_TOKEN: "test",
  GROQ_API_BASE: `http://localhost:${MOCK_PORT}`,
  MOCK_PORT: String(MOCK_PORT),
  // Code d'accès actif pendant tout le banc : chaque page se connecte, et la dernière série vérifie le frein.
  APP_PIN: "2468",
};

let code = 1;
try {
  run("node", ["scripts/test/mock-services.mjs"], env, "mock");
  await waitFor(`http://localhost:${MOCK_PORT}/v1/voices`, 10000);
  if (!process.env.SKIP_BUILD) {
    console.log("Construction de l'app…");
    await new Promise((resolve, reject) => {
      const b = spawn("npx", ["next", "build"], { env: { ...process.env, ...env }, stdio: ["ignore", "ignore", "pipe"] });
      let err = "";
      b.stderr.on("data", (d) => (err += d));
      b.on("exit", (c) => (c === 0 ? resolve() : reject(new Error(`build échoué\n${err.slice(-2000)}`))));
    });
  }
  run("npx", ["next", "start", "-p", String(APP_PORT)], env, "app");
  await waitFor(`http://localhost:${APP_PORT}/api/prononciation`, 60000);
  console.log(`App prête sur http://localhost:${APP_PORT}\n`);
  code = await new Promise((resolve) => {
    const t = spawn("node", ["scripts/test/e2e.mjs"], { env: { ...process.env, ...env, BASE_URL: `http://localhost:${APP_PORT}` }, stdio: "inherit" });
    t.on("exit", (c) => resolve(c ?? 1));
  });
} catch (error) {
  console.error(String(error?.message ?? error));
} finally {
  stopAll();
}
process.exit(code);
