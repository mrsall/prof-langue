#!/usr/bin/env node
/**
 * Serveur factice pour les tests automatiques : imite l'API Claude (Anthropic)
 * et les points d'entrée ElevenLabs utilisés par l'app. Aucune clé, aucun
 * réseau. Lancer avec :
 *   ANTHROPIC_BASE_URL=http://localhost:4545 ELEVENLABS_API_BASE=http://localhost:4545
 */
import http from "node:http";
import { WebSocketServer } from "ws";

const PORT = Number(process.env.MOCK_PORT || 4545);
const log = (...args) => console.log("[mock]", ...args);
/** Compteur d'appels par chemin, lisible sur GET /__stats (remis à zéro par POST /__reset). */
const stats = {};
const count = (key) => (stats[key] = (stats[key] ?? 0) + 1);
/** PC « éteint » (POST /__pc {down:true}) : plus de voix, d'oreille ni de temps réel. */
let pcDown = false;

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
      level: "B1",
      levelWhy: "Il raconte au passé avec des phrases complètes, quelques erreurs d'accord.",
    });
  }
  // Réplique du mode éco.
  if (/VIDE/.test(user)) return null; // simule une réponse sans texte
  if (/LONG/.test(user)) return french ? "Ah, le match d'hier, quelle soirée ! Moi, j'ai regardé la deuxième mi-temps avec mon cousin et on a crié comme des fous sur le but de la fin. Le gardien a fait un arrêt incroyable juste avant, tu as vu ça ? Franchement, je pensais que c'était fini pour eux à la mi-temps. Et toi, tu as regardé le match tout seul ou avec des amis ? Raconte-moi comment ça s'est passé chez toi." : "Oh, yesterday's match, what a night! I watched the second half with my cousin and we screamed like crazy at that last goal. The keeper made an incredible save just before it, did you see that? Honestly, I thought they were done at half time. And you, did you watch the match alone or with friends? Tell me how it went at your place."; // réplique longue (> 300 caractères)
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
  count(path.startsWith("/v1/text-to-speech/") ? "tts" : path.startsWith("/v1beta/models/") ? "gemini" : path);
  if (req.method === "GET" && path === "/__stats") return json(res, 200, stats);
  if (req.method === "POST" && path === "/__pc") {
    pcDown = Boolean(JSON.parse(raw.toString("utf8") || "{}").down);
    return json(res, 200, { down: pcDown });
  }
  if (pcDown && path.startsWith("/pc/")) return json(res, 503, { detail: "PC éteint (simulation)" });
  if (req.method === "POST" && path === "/__reset") {
    for (const k of Object.keys(stats)) delete stats[k];
    return json(res, 200, { ok: true });
  }

  // ---- Anthropic
  if (req.method === "POST" && path === "/v1/messages") {
    let body = {};
    try {
      body = JSON.parse(raw.toString("utf8") || "{}");
    } catch {
      return json(res, 400, { type: "error", error: { type: "invalid_request_error", message: "bad json" } });
    }
    const maxTokens = Number(body.max_tokens ?? 0);
    const thinkingOff = body.thinking?.type === "disabled";
    if (!thinkingOff && maxTokens < 600) {
      // Comme le vrai Haiku 5.5 : la réflexion consomme un petit plafond et aucun texte ne sort.
      return json(res, 200, { id: "msg_mock", type: "message", role: "assistant", model: body.model ?? "mock", content: [{ type: "thinking", thinking: "Je réfléchis longuement…", signature: "" }], stop_reason: "max_tokens", stop_sequence: null, usage: { input_tokens: 10, output_tokens: maxTokens } });
    }
    if (body.thinking?.type === "disabled" && /opus|sonnet/.test(String(body.model))) {
      // Ces modèles refusent de couper la réflexion : l'app doit réessayer sans ce réglage.
      return json(res, 400, { type: "error", error: { type: "invalid_request_error", message: "thinking.type: disabled is not supported for this model" } });
    }
    const user = lastUserText(body.messages ?? []);
    if (/LENT/.test(user)) await new Promise((r) => setTimeout(r, 1500)); // Claude lent : l'appui pendant la réflexion doit être refusé proprement
    const text = claudeAnswer(body);
    if (body.stream) {
      // Flux SSE comme la vraie API : le texte arrive par petits morceaux.
      res.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-cache" });
      const usage = { input_tokens: 10, output_tokens: 0, cache_creation_input_tokens: 0, cache_read_input_tokens: 0, server_tool_use: null, service_tier: null };
      const ev = (event, data) => res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
      ev("message_start", { type: "message_start", message: { id: "msg_mock", type: "message", role: "assistant", model: body.model ?? "mock", content: [], stop_reason: null, stop_sequence: null, usage } });
      if (text !== null) {
        ev("content_block_start", { type: "content_block_start", index: 0, content_block: { type: "text", text: "" } });
        for (const piece of text.match(/[\s\S]{1,14}/g) ?? []) {
          ev("content_block_delta", { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: piece } });
          await new Promise((r) => setTimeout(r, 12));
        }
        ev("content_block_stop", { type: "content_block_stop", index: 0 });
      }
      ev("message_delta", { type: "message_delta", delta: { stop_reason: "end_turn", stop_sequence: null }, usage: { output_tokens: 10, input_tokens: null, cache_creation_input_tokens: null, cache_read_input_tokens: null, server_tool_use: null } });
      ev("message_stop", { type: "message_stop" });
      return res.end();
    }
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

  // ---- PC de Cherif (Chatterbox)
  if (req.method === "GET" && path === "/pc/health") {
    return json(res, 200, { ok: true, warm: true, model: "chatterbox-multilingual (v3)", device: "cuda", gpu: "NVIDIA GeForce RTX 4070", voices: ["prof", "ami"], stt: "faster-whisper large-v3-turbo (cuda)", error: null });
  }
  if (req.method === "POST" && path === "/pc/stt") {
    if (req.headers.authorization !== "Bearer test") return json(res, 401, { detail: "Mot de passe refusé." });
    return json(res, 200, { text: "hier j'ai bu mon café", words: [{ text: "hier", start: 0.1, end: 0.4 }, { text: "café", start: 1.3, end: 1.7 }], durationMs: 1600, language: "fr" });
  }
  if (req.method === "POST" && path === "/pc/tts") {
    if (req.headers.authorization !== "Bearer test") return json(res, 401, { detail: "Mot de passe refusé." });
    let body = {};
    try {
      body = JSON.parse(raw.toString("utf8") || "{}");
    } catch {
      return json(res, 400, { detail: "bad json" });
    }
    if (/PANNE/.test(body.text ?? "")) return json(res, 503, { detail: "GPU occupé" }); // simule un PC en difficulté
    const wav = silentWav(0.4);
    res.writeHead(200, { "Content-Type": "audio/wav", "Content-Length": String(wav.length), "X-Generation-Ms": "320" });
    return res.end(wav);
  }

  // ---- Groq (Whisper)
  if (req.method === "POST" && path === "/openai/v1/audio/transcriptions") {
    return json(res, 200, { text: "hier j'ai bu mon café", words: [{ word: "hier", start: 0.1, end: 0.4 }, { word: "j'ai", start: 0.5, end: 0.7 }, { word: "bu", start: 0.8, end: 0.9 }, { word: "mon", start: 1.0, end: 1.2 }, { word: "café", start: 1.3, end: 1.7 }] });
  }

  // ---- Google (Gemini)
  if (req.method === "GET" && path === "/v1beta/models") {
    return json(res, 200, { models: [{ name: "models/gemini-2.5-flash-preview-tts", supportedGenerationMethods: ["generateContent"] }, { name: "models/gemini-2.5-flash", supportedGenerationMethods: ["generateContent"] }] });
  }
  if (req.method === "POST" && /^\/v1beta\/models\/[^/]+:generateContent$/.test(path)) {
    const pcm = Buffer.alloc(24000 * 2 * 0.3); // 0,3 s de silence 24 kHz
    return json(res, 200, { candidates: [{ content: { parts: [{ inlineData: { mimeType: "audio/L16;codec=pcm;rate=24000", data: pcm.toString("base64") } }] } }] });
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

// ---- PC de Cherif, mode temps réel (WebSocket /pc/live)
const wss = new WebSocketServer({ noServer: true });
server.on("upgrade", (req, socket, head) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  if (url.pathname !== "/pc/live" || pcDown) return socket.destroy();
  wss.handleUpgrade(req, socket, head, (ws) => {
    count("/pc/live");
    let loud = 0;
    let quiet = 0;
    let responding = false;
    let turns = 0;
    const send = (o) => ws.readyState === 1 && ws.send(JSON.stringify(o));
    const speak = async (text) => {
      send({ type: "speak", text, seq: 1 });
      ws.send(silentWav(0.3));
    };
    const reply = async (userText) => {
      responding = true;
      send({ type: "partial", text: userText.split(" ").slice(0, 2).join(" ") });
      await new Promise((r) => setTimeout(r, 80));
      send({ type: "user", text: userText });
      const answer = "Très bien, Cherif. Et après le café, qu'est-ce que tu as fait ?";
      for (const piece of answer.match(/[\s\S]{1,12}/g)) {
        send({ type: "delta", text: piece });
        await new Promise((r) => setTimeout(r, 10));
      }
      await speak("Très bien, Cherif.");
      send({ type: "timing", claudeMs: 420, voiceMs: 310 });
      await speak("Et après le café, qu'est-ce que tu as fait ?");
      send({ type: "agent", text: answer });
      turns += 1;
      responding = false;
      loud = 0;
      quiet = 0;
    };
    ws.on("message", (data, isBinary) => {
      if (!isBinary) {
        const cmd = JSON.parse(data.toString());
        log("live ←", cmd.type);
        if (cmd.type === "start") {
          if (!/^\d+\.[0-9a-f]{64}$/.test(cmd.ticket ?? "")) return send({ type: "error", message: "Ticket refusé", fatal: true });
          send({ type: "ready" });
          void speak(cmd.firstMessage).then(() => send({ type: "agent", text: cmd.firstMessage }));
        } else if (cmd.type === "repeat") {
          void speak("Et après le café, qu'est-ce que tu as fait ?");
        } else if (cmd.type === "flush") {
          if (loud >= 2 && !responding) void reply("hier j'ai bu mon café");
        } else if (cmd.type === "end") {
          ws.close();
        }
        return;
      }
      // Trames PCM 16 bits : énergie moyenne → « voix » ou « silence ».
      const pcm = new Int16Array(data.buffer, data.byteOffset, Math.floor(data.byteLength / 2));
      let sum = 0;
      for (let i = 0; i < pcm.length; i += 4) sum += pcm[i] * pcm[i];
      const rms = Math.sqrt(sum / Math.max(1, pcm.length / 4));
      if (rms > 800) {
        loud += 1;
        quiet = 0;
      } else if (loud > 0) {
        quiet += 1;
        if (loud >= 3 && quiet >= 4 && !responding) void reply("hier j'ai bu mon café");
      }
    });
  });
});

server.listen(PORT, () => log(`prêt sur http://localhost:${PORT}`));
