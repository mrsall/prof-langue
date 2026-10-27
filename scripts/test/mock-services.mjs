#!/usr/bin/env node
/**
 * Serveur factice pour les tests automatiques : imite l'API Claude (Anthropic)
 * et les points d'entrée ElevenLabs utilisés par l'app. Aucune clé, aucun
 * réseau. Lancer avec :
 *   ANTHROPIC_BASE_URL=http://localhost:4545 ELEVENLABS_API_BASE=http://localhost:4545
 */
import http from "node:http";

const PORT = Number(process.env.MOCK_PORT || 4545);
const log = (...args) => console.log("[mock]", ...args);

function json(res, status, body) {
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify(body));
}

function readBody(req) {
  return new Promise((resolve) => {
    const chunks = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => resolve(Buffer.concat(chunks)));
  });
}

/** WAV silencieux de 0,3 s : un vrai fichier audio, que le navigateur accepte. */
function silentWav(seconds = 0.3) {
  const rate = 24000;
  const samples = Math.round(rate * seconds);
  const buffer = Buffer.alloc(44 + samples * 2);
  buffer.write("RIFF", 0);
  buffer.writeUInt32LE(36 + samples * 2, 4);
  buffer.write("WAVE", 8);
  buffer.write("fmt ", 12);
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20);
  buffer.writeUInt16LE(1, 22);
  buffer.writeUInt32LE(rate, 24);
  buffer.writeUInt32LE(rate * 2, 28);
  buffer.writeUInt16LE(2, 32);
  buffer.writeUInt16LE(16, 34);
  buffer.write("data", 36);
  buffer.writeUInt32LE(samples * 2, 40);
  return buffer;
}

function systemText(system) {
  if (typeof system === "string") return system;
  if (Array.isArray(system)) return system.map((b) => (typeof b === "string" ? b : b?.text ?? "")).join("\n");
  return "";
}

function lastUserText(messages) {
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i];
    if (m.role !== "user") continue;
    if (typeof m.content === "string") return m.content;
    if (Array.isArray(m.content)) return m.content.map((b) => b?.text ?? "").join("\n");
  }
  return "";
}

/** Réponse de « Claude » selon la demande reçue. */
function claudeAnswer(body) {
  const system = systemText(body.system);
  const user = lastUserText(body.messages ?? []);
  // Langue de la séance : la consigne du mode éco est en français ou en anglais ; sinon on regarde la langue cible.
  const french = /Réponds en texte parlé simple/.test(system) || (!/You are speaking through a phone voice/.test(system) && /\bin French\b|français/.test(system));

  if (/JSON array of 4 short topic titles/.test(system)) {
    return /in English/.test(system)
      ? JSON.stringify(["Your day yesterday", "The last match", "A recent movie", "Your weekend plans"])
      : JSON.stringify(["Ta journée d'hier", "Le dernier match", "Un film récent", "Tes projets du week-end"]);
  }
  if (/\{"level":"A1\|A2/.test(system)) {
    return JSON.stringify({ level: "A2", summary: "Phrases simples, vocabulaire du quotidien.", strengths: ["Se présente clairement"], toWorkOn: ["Le passé composé", "Les liaisons"] });
  }
  if (/coach de prononciation/.test(system)) {
    return JSON.stringify([{ word: "café", sound: "é fermé", tip: "Étire un peu les lèvres et garde le son court." }]);
  }
  if (/"words":\[\{"en"/.test(system)) {
    const debate = /debat|débat|judge|juge/i.test(system) && /winner/.test(system);
    return JSON.stringify({
      words: [{ en: "yesterday", fr: "hier" }],
      errors: [{ wrong: "après avoir bu le café", right: "après avoir bu mon café", tip: "On garde le même possessif." }],
      corrections: [{ index: 1, corrected: "Hier, j'ai bu mon café, et après avoir bu mon café, je suis sorti." }],
      upgrades: [{ used: "truc", better: "appareil", why: "Plus précis pour un objet technique." }],
      debate: debate ? { winner: "cherif", why: "Deux arguments concrets contre un.", side: "for", bestArgument: "Le PC se répare pièce par pièce.", improvements: ["Donne un exemple chiffré."] } : null,
      encouragement: french ? "Belle séance, Cherif. Tu as raconté au passé sans aide." : "Nice work, Cherif. Clear past tense.",
      suggestTeacher: false,
      teacherFocus: null,
    });
  }
  // Réplique du mode éco.
  if (/VIDE/.test(user)) return null; // simule une réponse sans texte
  const debate = /debatteur|Leo/.test(system) && /<voice name=/.test(system);
  if (debate) {
    return french
      ? '<voice name="juge">Merci Cherif, position notée. Leo, à toi.</voice> Je ne suis pas d\'accord : une console, ça marche tout de suite, sans réglages. Pourquoi le PC serait mieux ?'
      : '<voice name="judge">Thank you Cherif. Leo, your turn.</voice> I disagree: a console just works, no setup. Why would a PC be better?';
  }
  if (/premier|first one|Prêt \?|Ready\?/.test(system) && /révision|review/i.test(system)) {
    return french ? "Premier mot : « hier ». Tu me le traduis ?" : "First word: yesterday. Can you translate it?";
  }
  return french ? "Très bien, Cherif. Et après le café, qu'est-ce que tu as fait ?" : "Nice! And what did you do after that?";
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  const path = url.pathname;
  const raw = await readBody(req);
  log(req.method, path);

  // ---- Anthropic
  if (req.method === "POST" && path === "/v1/messages") {
    let body = {};
    try {
      body = JSON.parse(raw.toString("utf8") || "{}");
    } catch {
      return json(res, 400, { type: "error", error: { type: "invalid_request_error", message: "bad json" } });
    }
    const text = claudeAnswer(body);
    return json(res, 200, {
      id: "msg_mock",
      type: "message",
      role: "assistant",
      model: body.model ?? "mock",
      content: text === null ? [] : [{ type: "text", text }],
      stop_reason: "end_turn",
      stop_sequence: null,
      usage: { input_tokens: 10, output_tokens: 10 },
    });
  }

  // ---- ElevenLabs
  if (req.method === "GET" && path === "/v1/voices") {
    return json(res, 200, {
      voices: [
        { voice_id: "frm1", name: "FR · Pierre", category: "professional", labels: { language: "fr", gender: "male", accent: "parisian", app: "prof-langue-fr" } },
        { voice_id: "frf1", name: "FR · Claire", category: "professional", labels: { language: "fr", gender: "female", accent: "standard", app: "prof-langue-fr" } },
        { voice_id: "JBFqnCBsobJjWmhhKeHm", name: "George", category: "premade", labels: { language: "en", gender: "male", accent: "british" } },
      ],
    });
  }
  if (req.method === "GET" && path === "/v1/shared-voices") return json(res, 200, { voices: [], has_more: false });
  if (req.method === "POST" && path.startsWith("/v1/voices/add/")) return json(res, 200, { voice_id: "frnew" });
  if (req.method === "POST" && /^\/v1\/voices\/[^/]+\/edit$/.test(path)) return json(res, 200, { status: "ok" });
  if (req.method === "POST" && path.startsWith("/v1/text-to-speech/")) {
    const wav = silentWav();
    res.writeHead(200, { "Content-Type": "audio/wav", "Content-Length": String(wav.length) });
    return res.end(wav);
  }
  if (req.method === "POST" && path === "/v1/speech-to-text") {
    return json(res, 200, {
      text: "hier j'ai bu mon café",
      words: [
        { text: "hier", start: 0.1, end: 0.4, type: "word" },
        { text: "j'ai", start: 0.5, end: 0.7, type: "word" },
        { text: "bu", start: 0.8, end: 0.9, type: "word" },
        { text: "mon", start: 1.0, end: 1.2, type: "word" },
        { text: "café", start: 1.3, end: 1.7, type: "word" },
      ],
    });
  }
  if (req.method === "GET" && path.startsWith("/v1/convai/agents/")) {
    return json(res, 200, {
      agent_id: "test",
      conversation_config: { agent: { prompt: { llm: "claude-haiku-5-5" } }, tts: { model_id: "eleven_flash_v2_5", supported_voices: [{ label: "judge", voice_id: "x" }, { label: "juge", voice_id: "y" }] }, language_presets: { fr: {} } },
      platform_settings: { overrides: { conversation_config_override: { agent: { first_message: true, language: true, prompt: { prompt: true } }, tts: { voice_id: true, speed: true } } } },
    });
  }
  if (req.method === "GET" && path.startsWith("/v1/convai/conversation/")) return json(res, 200, { token: "tok", signed_url: "wss://mock" });

  json(res, 404, { error: `mock: ${req.method} ${path} inconnu` });
});

server.listen(PORT, () => log(`prêt sur http://localhost:${PORT}`));
