#!/usr/bin/env node
/**
 * Parcours complet de l'app dans un navigateur, avec micro, voix du téléphone,
 * lecteur audio, Claude et ElevenLabs simulés. Vérifie que la conversation en
 * mode éco, le bilan, la prononciation, le suivi, le carnet et les réglages
 * fonctionnent de bout en bout, sans erreur bloquante.
 *
 *   BASE_URL=http://localhost:3300 node scripts/test/e2e.mjs
 */
import { mkdirSync } from "node:fs";
import { createRequire } from "node:module";

// Playwright est préinstallé sur la machine de test (pas dans le projet) : on le charge par require.
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_PATH || "playwright");

const BASE = (process.env.BASE_URL || "http://localhost:3300").replace(/\/+$/, "");
const SHOTS = process.env.SHOTS_DIR || "/tmp/claude-0/e2e-shots";
const MOCK = `http://localhost:${process.env.MOCK_PORT || 4545}`;
mkdirSync(SHOTS, { recursive: true });

const results = [];
let page;
let consoleErrors = [];
let fallbackWarnings = [];

async function step(name, fn) {
  const start = Date.now();
  try {
    await fn();
    results.push({ name, ok: true, ms: Date.now() - start });
    console.log(`  ✓ ${name} (${Date.now() - start} ms)`);
  } catch (error) {
    results.push({ name, ok: false, ms: Date.now() - start, error: String(error?.message ?? error) });
    console.log(`  ✗ ${name} : ${String(error?.message ?? error).split("\n")[0]}`);
    try {
      await page?.screenshot({ path: `${SHOTS}/${results.length}-${name.replace(/[^a-z0-9]+/gi, "-").toLowerCase()}.png`, fullPage: true });
    } catch {
      // pas de capture
    }
  }
}

/** Faux micro, fausse voix, faux lecteur audio : tout ce que le navigateur sans tête n'a pas. */
const STUBS = `
  (() => {
    window.__nextSpeech = "";
    window.__speechQueue = [];
    window.__spoken = [];
    // Faux micro : « a ... b » arrive en deux morceaux séparés de 900 ms, comme une vraie pause ;
    // le téléphone s'arrête après chaque morceau (onend) et l'app doit le relancer.
    class FakeRecognition {
      constructor() { this.lang = ""; this.continuous = false; this.interimResults = false; this.maxAlternatives = 1; this.onresult = null; this.onerror = null; this.onend = null; this.onspeechstart = null; this.onspeechend = null; this._stopped = false; }
      start() {
        const self = this;
        if (window.__nextSpeech) { window.__speechQueue = window.__nextSpeech.split(" ... "); window.__nextSpeech = ""; self._first = true; }
        const part = window.__speechQueue.shift();
        if (part) {
          const delay = self._first ? 100 : 900;
          self._first = false;
          // Comme Android : d'abord des provisoires cumulés (« salut », « salut je »…), puis un final avec toute la prise.
          const words = part.split(" ");
          const emit = (list, final) => {
            const results = { length: list.length };
            list.forEach((t, i) => { results[i] = { isFinal: final && i === list.length - 1, length: 1, 0: { transcript: t, confidence: 0.9 } }; });
            self.onresult && self.onresult({ resultIndex: 0, results });
          };
          setTimeout(() => {
            if (self._stopped) return;
            self.onspeechstart && self.onspeechstart();
            let n = 1;
            const tick = () => {
              if (self._stopped) return;
              if (n < words.length) { emit([words.slice(0, n).join(" ")], false); n += 1; setTimeout(tick, 60); return; }
              emit([part], true);
              self.onspeechend && self.onspeechend();
              self.onend && self.onend();
            };
            tick();
          }, delay);
        } else {
          setTimeout(() => { if (!self._stopped) { self.onend && self.onend(); } }, 400);
        }
      }
      stop() { this._stopped = true; const self = this; setTimeout(() => self.onend && self.onend(), 20); }
      abort() { this._stopped = true; }
    }
    window.SpeechRecognition = FakeRecognition;
    window.webkitSpeechRecognition = FakeRecognition;

    class FakeUtterance { constructor(text) { this.text = text; this.lang = ""; this.voice = null; this.rate = 1; this.pitch = 1; this.onstart = null; this.onend = null; this.onerror = null; } }
    window.SpeechSynthesisUtterance = FakeUtterance;
    const voices = [{ name: "Thomas", lang: "fr-FR", localService: true }, { name: "Daniel", lang: "en-GB", localService: true }];
    Object.defineProperty(window, "speechSynthesis", { value: {
      getVoices: () => voices,
      speak: (u) => { window.__spoken.push(u.text); setTimeout(() => { u.onstart && u.onstart(); setTimeout(() => u.onend && u.onend(), 80); }, 20); },
      cancel: () => {},
      addEventListener: () => {},
      speaking: false,
    }, configurable: true });

    HTMLMediaElement.prototype.play = function () { const el = this; setTimeout(() => el.dispatchEvent(new Event("playing")), 10); setTimeout(() => el.dispatchEvent(new Event("ended")), 120); return Promise.resolve(); };
    HTMLMediaElement.prototype.pause = function () {};
    HTMLMediaElement.prototype.load = function () {};

    Object.defineProperty(navigator, "mediaDevices", { value: { getUserMedia: async () => ({ getTracks: () => [] }) }, configurable: true });
    // Faux traitement du son pour l'enregistreur WAV : le niveau du micro se pilote par window.__micLevel (0 = silence).
    window.__micLevel = 0;
    class FakeAudioContext {
      constructor() { this.state = "running"; this.sampleRate = 16000; this.destination = {}; this._timers = []; }
      resume() { return Promise.resolve(); }
      close() { this._timers.forEach((t) => clearInterval(t)); return Promise.resolve(); }
      get currentTime() { return performance.now() / 1000; }
      decodeAudioData(buf) { return Promise.resolve({ duration: Math.max(0.05, (buf.byteLength - 44) / 2 / 24000) }); }
      createBufferSource() {
        const node = { buffer: null, onended: null, playbackRate: { value: 1 }, connect() {}, stop() {}, start(when) {
          const delay = Math.max(0, ((when ?? 0) - performance.now() / 1000) * 1000) + (node.buffer?.duration ?? 0.1) * 1000;
          setTimeout(() => node.onended && node.onended(), delay);
        } };
        return node;
      }
      createMediaStreamSource() { return { connect() {}, disconnect() {} }; }
      createGain() { return { gain: { value: 1 }, connect() {}, disconnect() {} }; }
      createScriptProcessor(size) {
        const node = { onaudioprocess: null, connect() {}, disconnect() {} };
        const timer = setInterval(() => {
          if (!node.onaudioprocess) return;
          const level = window.__micLevel || 0;
          const data = new Float32Array(size);
          for (let i = 0; i < size; i++) data[i] = level * Math.sin(i / 10);
          node.onaudioprocess({ inputBuffer: { getChannelData: () => data } });
        }, Math.round((size / 16000) * 1000));
        this._timers.push(timer);
        return node;
      }
    }
    window.AudioContext = FakeAudioContext;
    window.webkitAudioContext = FakeAudioContext;
    navigator.vibrate = () => true;
    navigator.serviceWorker && (navigator.serviceWorker.register = async () => ({}));
  })();
`;

function presets(values) {
  return `(() => { try { ${Object.entries(values)
    .map(([k, v]) => `localStorage.setItem(${JSON.stringify(k)}, ${JSON.stringify(v)});`)
    .join(" ")} } catch {} })();`;
}

async function newPage(browser, storage) {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, locale: "fr-FR" });
  await context.addInitScript(STUBS);
  await context.addInitScript(presets({ "prof-langue:show-text": "1", "prof-langue:talk-mode": "mains-libres", ...storage }));
  const p = await context.newPage();
  consoleErrors = [];
  fallbackWarnings = [];
  p.on("console", (msg) => {
    const text = msg.text();
    if (msg.type() === "error" && !/favicon|404|net::ERR|Failed to load resource|cdn.jsdelivr|huggingface/i.test(text)) consoleErrors.push(text);
    if (/repli sur la voix du téléphone/.test(text)) fallbackWarnings.push(text);
  });
  p.on("pageerror", (err) => consoleErrors.push(`pageerror: ${err.message}`));
  return p;
}

const transcript = '[aria-label="Texte de la conversation"] p';

async function waitBubble(text, timeout = 20000) {
  await page.waitForFunction(
    ([sel, t]) => Array.from(document.querySelectorAll(sel)).some((p) => (p.textContent || "").toLowerCase().includes(t.toLowerCase())),
    [transcript, text],
    { timeout },
  );
}

async function countBubbles(text) {
  const all = await page.locator(transcript).allTextContents();
  return all.filter((t) => t.toLowerCase().includes(text.toLowerCase())).length;
}

async function mockStats(reset = false) {
  if (reset) await page.request.post(`${MOCK}/__reset`);
  return (await page.request.get(`${MOCK}/__stats`)).json();
}

async function noBlockingError() {
  const retry = await page.locator("button", { hasText: "Réessayer" }).count();
  if (retry > 0) {
    const msg = await page.locator(".text-danger").first().textContent().catch(() => "");
    throw new Error(`erreur bloquante affichée : ${msg}`);
  }
}

async function startSession(language, mode, topicPick = "first") {
  await page.goto(`${BASE}/`);
  await page.getByRole("button", { name: "Commencer", exact: true }).waitFor({ timeout: 20000 });
  await page.getByRole("radiogroup", { name: "Langue" }).getByRole("radio", { name: language === "fr" ? "Français" : "Anglais" }).click();
  await page.getByRole("radiogroup", { name: "Mode" }).getByRole("radio", { name: new RegExp(mode) }).click();
  await page.getByRole("button", { name: "Commencer", exact: true }).click();
  // Écran des sujets : les sujets viennent du faux Claude.
  const topic = page.locator("main button").filter({ hasText: topicPick === "first" ? /journée|day|match|film|movie|week-end|weekend|PC|console/i : topicPick }).first();
  await topic.waitFor({ timeout: 20000 });
  await topic.click();
}

const browser = await chromium.launch();
try {
  // ------------------------------------------------------------------ Routes serveur (sans navigateur)
  console.log("Routes serveur");
  page = await newPage(browser, {});
  await step("Séance ElevenLabs temps réel : jeton + consignes + première réplique", async () => {
    const res = await page.request.post(`${BASE}/api/elevenlabs/session`, { data: { personality: "prof", language: "fr", correction: "active", speed: "lent", topic: "Raconter au passé", ownTopic: false, kind: "conversation" } });
    if (!res.ok()) throw new Error(`HTTP ${res.status()} ${(await res.text()).slice(0, 200)}`);
    const data = await res.json();
    if (!data.conversationToken || !data.overrides?.agent?.prompt?.prompt || !data.overrides?.agent?.firstMessage) throw new Error(`réponse incomplète : ${JSON.stringify(data).slice(0, 200)}`);
    if (data.overrides.agent.language !== "fr" || data.overrides.tts?.speed !== 0.85) throw new Error("langue ou vitesse non transmises");
  });
  await step("Agent ElevenLabs : état lu et accepté", async () => {
    const res = await page.request.get(`${BASE}/api/elevenlabs/agent`);
    const data = await res.json();
    if (!res.ok() || data.ok !== true) throw new Error(`agent : ${JSON.stringify(data).slice(0, 200)}`);
  });
  await step("Voix françaises : au moins un homme et une femme", async () => {
    const res = await page.request.get(`${BASE}/api/elevenlabs/voices-fr`);
    const data = await res.json();
    if (!res.ok() || data.ok !== true) throw new Error(`voix FR : ${JSON.stringify(data).slice(0, 200)}`);
  });
  await step("Lecture ElevenLabs (/api/tts) avec voix du personnage et du juge", async () => {
    for (const q of ["lang=fr&personality=prof", "lang=en&personality=debatteur&role=judge"]) {
      const res = await page.request.get(`${BASE}/api/tts?text=Bonjour&${q}`);
      if (!res.ok() || !(res.headers()["content-type"] ?? "").startsWith("audio/")) throw new Error(`tts ${q} : HTTP ${res.status()} ${res.headers()["content-type"]}`);
    }
  });
  await step("Voix Google (/api/tts?engine=gemini) et son diagnostic", async () => {
    const res = await page.request.get(`${BASE}/api/tts?text=Bonjour&lang=fr&personality=prof&engine=gemini`);
    if (!res.ok() || !(res.headers()["content-type"] ?? "").startsWith("audio/wav")) throw new Error(`tts gemini : HTTP ${res.status()} ${res.headers()["content-type"]}`);
    const diag = await (await page.request.get(`${BASE}/api/diagnostic/gemini`)).json();
    if (!diag.ok || !/tts/.test(diag.model ?? "")) throw new Error(JSON.stringify(diag).slice(0, 200));
  });
  await step("Voix « Mon PC » (/api/tts?engine=pc), diagnostic, et repli ElevenLabs si le PC flanche", async () => {
    const res = await page.request.get(`${BASE}/api/tts?text=Bonjour&lang=fr&personality=prof&engine=pc`);
    if (!res.ok() || !(res.headers()["content-type"] ?? "").startsWith("audio/wav")) throw new Error(`tts pc : HTTP ${res.status()} ${res.headers()["content-type"]}`);
    const diag = await (await page.request.get(`${BASE}/api/diagnostic/pc`)).json();
    if (!diag.ok || !/4070/.test(diag.gpu ?? "")) throw new Error(JSON.stringify(diag).slice(0, 200));
    const down = await page.request.get(`${BASE}/api/tts?text=PANNE&lang=fr&personality=prof&engine=pc`);
    if (down.ok()) throw new Error("un PC en panne devrait répondre une erreur (le téléphone bascule alors sur ElevenLabs)");
  });
  await step("Diagnostic Claude : réponse avec du texte (le faux Claude rend une réponse vide si le plafond est trop bas)", async () => {
    const res = await page.request.get(`${BASE}/api/diagnostic/claude`);
    const data = await res.json();
    if (!data.ok || data.stopReason !== "end_turn") throw new Error(JSON.stringify(data).slice(0, 200));
  });
  await step("Réplique éco directe (/api/eco/reply) : texte présent, sans repli", async () => {
    const res = await page.request.post(`${BASE}/api/eco/reply`, { data: { personality: "ami", language: "fr", correction: "legere", speed: "normal", topic: "Ta journée", ownTopic: false, kind: "conversation", transcript: [{ role: "agent", text: "Salut Cherif !" }, { role: "user", text: "hier j'ai bu mon café" }] } });
    const data = await res.json();
    if (!res.ok() || !data.text || data.fallback) throw new Error(JSON.stringify(data).slice(0, 200));
  });
  await step("Réplique éco en flux : morceaux puis « done » avec le texte complet", async () => {
    const res = await page.request.post(`${BASE}/api/eco/reply`, { data: { personality: "ami", language: "fr", correction: "legere", speed: "normal", topic: "Ta journée", ownTopic: false, kind: "conversation", stream: true, transcript: [{ role: "agent", text: "Salut Cherif !" }, { role: "user", text: "hier j'ai bu mon café" }] } });
    if (!res.ok() || !/ndjson/.test(res.headers()["content-type"] ?? "")) throw new Error(`HTTP ${res.status()} ${res.headers()["content-type"]}`);
    const events = (await res.text()).trim().split("\n").map((l) => JSON.parse(l));
    const deltas = events.filter((e) => e.type === "delta").length;
    const done = events.find((e) => e.type === "done");
    if (deltas < 2 || !done?.text || !/après le café/.test(done.text)) throw new Error(`flux : ${deltas} morceaux, done=${JSON.stringify(done).slice(0, 100)}`);
  });
  await step("Sujets, bilan et niveau : JSON de Claude bien lu", async () => {
    const sujets = await (await page.request.post(`${BASE}/api/sujets`, { data: { personality: "ami", language: "en", recent: [] } })).json();
    if (!Array.isArray(sujets.topics) || sujets.topics.length < 3) throw new Error(`sujets : ${JSON.stringify(sujets).slice(0, 120)}`);
    const transcript = [
      { role: "agent", text: "Bonjour Cherif, raconte-moi ta journée d'hier." },
      { role: "user", text: "hier j'ai bu mon café et après avoir bu le café" },
      { role: "agent", text: "Très bien. Et ensuite ?" },
      { role: "user", text: "je suis allé au travail" },
      { role: "agent", text: "Qu'est-ce que tu as fait au travail ?" },
      { role: "user", text: "j'ai vérifié les bananes et j'ai appelé un client" },
      { role: "agent", text: "Et le soir ?" },
      { role: "user", text: "le soir j'ai regardé un match avec mes amis" },
    ];
    const bilan = await (await page.request.post(`${BASE}/api/bilan`, { data: { transcript, durationSeconds: 120, personality: "prof", language: "fr" } })).json();
    if (!Array.isArray(bilan.errors) || !Array.isArray(bilan.corrections) || bilan.corrections.length < 1) throw new Error(`bilan : ${JSON.stringify(bilan).slice(0, 160)}`);
    if (!/^[ABC][12]$/.test(bilan.level ?? "")) throw new Error(`bilan sans niveau observé : ${JSON.stringify(bilan).slice(0, 120)}`);
    const niveau = await (await page.request.post(`${BASE}/api/niveau`, { data: { transcript, language: "fr" } })).json();
    if (!/^[ABC][12]$/.test(niveau.level ?? "")) throw new Error(`niveau : ${JSON.stringify(niveau).slice(0, 120)}`);
  });
  await step("Progression du niveau : trois séances au-dessus du niveau → niveau suivant", async () => {
    if (!process.env.DATABASE_URL) return;
    const transcript = Array.from({ length: 4 }, (_, i) => [{ role: "agent", text: `Question ${i}` }, { role: "user", text: `my answer number ${i} with several words` }]).flat();
    // Niveau de départ connu : le test (Claude simulé) enregistre A2 en anglais.
    const niveau = await (await page.request.post(`${BASE}/api/niveau`, { data: { transcript, language: "en" } })).json();
    if (niveau.level !== "A2") throw new Error(`niveau de départ : ${JSON.stringify(niveau).slice(0, 100)}`);
    let last = null;
    for (let i = 0; i < 3; i++) {
      const res = await page.request.post(`${BASE}/api/sessions`, { data: { kind: "conversation", engine: "eco", language: "en", personality: "ami", seconds: 200, userTurns: 8, userShare: 60, transcript, observedLevel: "B1" } });
      last = await res.json();
      if (!last.saved) throw new Error(`séance non enregistrée : ${JSON.stringify(last).slice(0, 120)}`);
    }
    if (last?.progression?.promoted !== "B1") throw new Error(`pas de passage au niveau B1 : ${JSON.stringify(last?.progression)}`);
    const suivi = await (await page.request.get(`${BASE}/api/suivi`)).json();
    if (suivi.levels?.en !== "B1" || !Array.isArray(suivi.progression) || suivi.progression.length < 3) throw new Error(`suivi : ${JSON.stringify({ levels: suivi.levels, progression: suivi.progression }).slice(0, 160)}`);
  });
  await step("Transcription de secours (/api/stt, Groq puis Scribe) et phonèmes français (/api/phonemes)", async () => {
    const wav = Buffer.alloc(44 + 16000);
    wav.write("RIFF", 0);
    wav.write("WAVE", 8);
    const stt = await page.request.post(`${BASE}/api/stt`, { multipart: { language: "fr", engine: "groq", audio: { name: "a.wav", mimeType: "audio/wav", buffer: wav } } });
    const sttData = await stt.json();
    if (!stt.ok() || !sttData.text || sttData.engine !== "groq") throw new Error(`stt groq : ${JSON.stringify(sttData).slice(0, 120)}`);
    const scribe = await (await page.request.post(`${BASE}/api/stt`, { multipart: { language: "fr", engine: "scribe", audio: { name: "a.wav", mimeType: "audio/wav", buffer: wav } } })).json();
    if (scribe.engine !== "scribe" || !scribe.text) throw new Error(`stt scribe : ${JSON.stringify(scribe).slice(0, 120)}`);
    const pcEar = await (await page.request.post(`${BASE}/api/stt`, { multipart: { language: "fr", engine: "pc", audio: { name: "a.wav", mimeType: "audio/wav", buffer: wav } } })).json();
    if (pcEar.engine !== "pc" || !pcEar.text) throw new Error(`stt pc : ${JSON.stringify(pcEar).slice(0, 120)}`);
    const ph = await (await page.request.post(`${BASE}/api/phonemes`, { data: { sentences: ["Salut Cherif ! Ça va ?"], language: "fr" } })).json();
    if (!ph.phonemes?.[0] || !/salˈy/.test(ph.phonemes[0])) throw new Error(`phonèmes : ${JSON.stringify(ph).slice(0, 120)}`);
  });
  await page.context().close();

  // ------------------------------------------------------------------ Séance éco en français avec Emma
  page = await newPage(browser, { "prof-langue:engine": "eco", "prof-langue:voice-choice": "eleven", "prof-langue:language": "fr", "prof-langue:mode": "prof" });
  console.log("Séance éco (ElevenLabs lecture seule), Emma, français");
  let connectAt = 0;
  await step("Accueil → sujet → séance démarre et Emma parle", async () => {
    await startSession("fr", "Emma");
    await page.waitForSelector(transcript, { timeout: 25000 });
    connectAt = Date.now();
    const header = await page.locator("header").first().textContent();
    if (!/éco/.test(header ?? "")) throw new Error(`en-tête sans « éco » : ${header}`);
    await noBlockingError();
  });
  await step("Cherif parle → Emma répond (Claude simulé) sans erreur", async () => {
    await page.evaluate(() => {
      window.__nextSpeech = "hier j'ai bu mon café et après avoir bu le café";
    });
    await waitBubble("hier j'ai bu mon café");
    await waitBubble("après le café");
    await noBlockingError();
    if (fallbackWarnings.length) throw new Error(`la voix ElevenLabs n'a pas été utilisée : ${fallbackWarnings[0]}`);
  });
  await step("Répète relit la dernière réplique", async () => {
    await page.getByRole("button", { name: /Répète/ }).click();
    await page.waitForTimeout(800);
    await noBlockingError();
  });
  await step("Réplique longue (> 300 caractères) : affichée entière et lue en plusieurs morceaux ElevenLabs", async () => {
    await mockStats(true);
    await page.evaluate(() => {
      window.__nextSpeech = "LONG j'ai regardé le match";
    });
    await waitBubble("comment ça s'est passé chez toi", 25000);
    // La bulle s'affiche avant que les morceaux audio soient tous demandés : on laisse quelques secondes.
    let stats = await mockStats();
    for (let i = 0; i < 20 && !(stats.tts >= 2); i++) {
      await page.waitForTimeout(250);
      stats = await mockStats();
    }
    if (!(stats.tts >= 2)) throw new Error(`la réplique longue n'a pas été coupée en morceaux (appels tts : ${stats.tts ?? 0})`);
    if (fallbackWarnings.length) throw new Error(fallbackWarnings[0]);
    await noBlockingError();
  });
  await step("Changer la vitesse relance la séance avec une phrase de reprise", async () => {
    await page.getByRole("button", { name: /Vitesse/ }).click();
    await waitBubble("où en étions-nous", 25000);
    await noBlockingError();
  });
  await step("Réponse vide de Claude → le personnage relance au lieu de casser", async () => {
    await page.evaluate(() => {
      window.__nextSpeech = "VIDE";
    });
    await waitBubble("souci de mon côté", 25000);
    await noBlockingError();
  });
  await step("Terminer → bilan avec corrections et bouton de prononciation", async () => {
    // Une séance de moins de 30 s est une « séance éclair » sans exercice de prononciation.
    const remaining = 32000 - (Date.now() - connectAt);
    if (remaining > 0) await page.waitForTimeout(remaining);
    await page.getByRole("button", { name: "Terminer" }).click();
    await page.getByText(/À retenir|Texte de la séance/).first().waitFor({ timeout: 30000 });
    await page.getByText(/Répéter \d+ phrase/).waitFor({ timeout: 10000 });
    await page.getByText(/Niveau observé aujourd/).waitFor({ timeout: 10000 });
  });
  await step("Prononciation depuis le bilan : écoute, répétition notée, phrase suivante", async () => {
    await page.getByText(/Répéter \d+ phrase/).click();
    await page.waitForURL(/\/prononciation/, { timeout: 15000 });
    await page.getByText(/Phrase 1 sur/).waitFor({ timeout: 20000 });
    const phrase = (await page.locator("p.text-lg.font-semibold").first().textContent()) ?? "";
    await page.getByRole("button", { name: "Écouter", exact: true }).click();
    await page.waitForTimeout(600);
    const words = phrase.split(" ");
    if (words.length > 2) words[1] = "zzz";
    await page.evaluate((t) => {
      window.__nextSpeech = t;
    }, words.join(" "));
    await page.getByRole("button", { name: "Je répète" }).click();
    await page.getByText("Mots compris").waitFor({ timeout: 30000 });
    const chips = await page.locator("p.flex.flex-wrap button").count();
    if (chips < 3) throw new Error(`seulement ${chips} mots colorés`);
    await page.getByRole("button", { name: "Phrase suivante" }).click();
    await page.getByText(/Phrase 2 sur/).waitFor({ timeout: 10000 });
  });
  await step("Suivi, carnet et réglages se chargent sans erreur de base", async () => {
    await page.goto(`${BASE}/suivi`);
    await page.getByText(/séance|jour de suite/).first().waitFor({ timeout: 20000 });
    if (await page.getByText(/La base de données ne répond pas/).count()) throw new Error("suivi : erreur de base");
    await page.goto(`${BASE}/carnet`);
    await page.waitForTimeout(1500);
    if (await page.getByText(/La base de données ne répond pas/).count()) throw new Error("carnet : erreur de base");
    await page.goto(`${BASE}/reglages`);
    await page.getByText("Base de données").waitFor({ timeout: 20000 });
    await page.waitForTimeout(1500);
    const badge = await page.locator("section", { hasText: "Base de données" }).first().textContent();
    if (process.env.DATABASE_URL && !/Prête/.test(badge ?? "")) throw new Error(`réglages : base pas « Prête » (${(badge ?? "").slice(0, 120)})`);
  });
  await step("Aucune erreur JavaScript dans la page", async () => {
    if (consoleErrors.length) throw new Error(consoleErrors.slice(0, 3).join(" | "));
  });
  await page.context().close();

  // ------------------------------------------------------------------ Séance éco avec la voix Google
  page = await newPage(browser, { "prof-langue:engine": "eco", "prof-langue:voice-choice": "gemini", "prof-langue:language": "fr", "prof-langue:mode": "ami" });
  console.log("Séance éco avec la voix Google, Max, français");
  await step("Max parle avec la voix Google, Cherif répond, Max enchaîne", async () => {
    await startSession("fr", "Max");
    await page.waitForSelector(transcript, { timeout: 25000 });
    const header = await page.locator("header").first().textContent();
    if (!/Google/.test(header ?? "")) throw new Error(`en-tête : ${header}`);
    await page.evaluate(() => {
      window.__nextSpeech = "hier j'ai regardé un match";
    });
    await waitBubble("après le café", 25000);
    if (fallbackWarnings.length) throw new Error(fallbackWarnings[0]);
    await noBlockingError();
  });
  await step("Une phrase avec une pause au milieu arrive entière", async () => {
    // Le faux micro envoie d'abord un morceau provisoire, puis la suite : l'app doit attendre le vrai silence.
    await page.evaluate(() => {
      window.__nextSpeech = "hier j'ai bu mon café ... et après je suis sorti";
    });
    await waitBubble("et après je suis sorti", 25000);
    const bubbles = await page.locator(transcript).allTextContents();
    const mine = bubbles.find((t) => /et après je suis sorti/.test(t)) ?? "";
    if (mine.toLowerCase() !== "hier j'ai bu mon café et après je suis sorti") throw new Error(`mots doublés ou manquants : « ${mine} »`);
    await noBlockingError();
  });
  await page.context().close();

  // ------------------------------------------------------------------ Séance éco avec la voix du PC
  page = await newPage(browser, { "prof-langue:engine": "eco", "prof-langue:voice-choice": "pc", "prof-langue:language": "en", "prof-langue:mode": "ami" });
  console.log("Séance éco avec la voix du PC (Chatterbox simulé), Max, anglais");
  await step("Max parle avec la voix du PC, Cherif répond, Max enchaîne", async () => {
    await mockStats(true);
    await startSession("en", "Max");
    await page.waitForSelector(transcript, { timeout: 25000 });
    const header = await page.locator("header").first().textContent();
    if (!/Mon/.test(header ?? "")) throw new Error(`en-tête : ${header}`);
    await page.evaluate(() => {
      window.__nextSpeech = "I watched a match yesterday";
    });
    await waitBubble("what did you do after", 25000);
    const stats = await mockStats();
    if (!(stats["/pc/tts"] >= 2)) throw new Error(`le PC n'a pas fabriqué les répliques : ${JSON.stringify(stats)}`);
    if (fallbackWarnings.length) throw new Error(fallbackWarnings[0]);
    await noBlockingError();
  });
  await page.context().close();

  // ------------------------------------------------------------------ Débat éco : juge + Leo, balises invisibles
  page = await newPage(browser, { "prof-langue:engine": "eco", "prof-langue:voice-choice": "eleven", "prof-langue:language": "fr", "prof-langue:mode": "debatteur" });
  console.log("Débat éco, Leo + juge, français");
  await step("Le juge ouvre le débat, sans balise visible", async () => {
    await startSession("fr", "Leo");
    await page.waitForSelector(transcript, { timeout: 25000 });
    const first = (await page.locator(transcript).first().textContent()) ?? "";
    if (/<voice/i.test(first)) throw new Error(`balise visible : ${first.slice(0, 80)}`);
    await noBlockingError();
  });
  await step("Cherif prend position → le juge passe la parole, Leo conteste", async () => {
    await page.evaluate(() => {
      window.__nextSpeech = "Je préfère le PC parce qu'on peut le réparer";
    });
    await waitBubble("Pourquoi le PC");
    const all = await page.locator(transcript).allTextContents();
    if (all.some((t) => /<voice/i.test(t))) throw new Error("balise <voice> affichée");
    await noBlockingError();
  });
  await step("Aucune erreur JavaScript (débat)", async () => {
    if (consoleErrors.length) throw new Error(consoleErrors.slice(0, 3).join(" | "));
  });
  await page.context().close();

  // ------------------------------------------------------------------ Kokoro indisponible → repli automatique
  page = await newPage(browser, { "prof-langue:engine": "eco", "prof-langue:voice-choice": "kokoro", "prof-langue:language": "en", "prof-langue:mode": "ami" });
  console.log("Kokoro indisponible (pas de CDN ici) → repli sur ElevenLabs");
  await step("La séance démarre quand même, avec un avertissement et sans erreur bloquante", async () => {
    await startSession("en", "Max");
    await page.waitForSelector(transcript, { timeout: 60000 });
    await noBlockingError();
  });
  await step("Cherif parle en anglais → Max répond", async () => {
    await page.evaluate(() => {
      window.__nextSpeech = "I played football with my friends";
    });
    await waitBubble("what did you do after", 25000);
    await noBlockingError();
  });
  await page.context().close();

  // ------------------------------------------------------------------ Oreille Groq : enregistrement + Whisper
  page = await newPage(browser, { "prof-langue:engine": "eco", "prof-langue:voice-choice": "phone", "prof-langue:ear-choice": "groq", "prof-langue:language": "fr", "prof-langue:mode": "ami" });
  console.log("Oreille Groq (enregistrement + Whisper simulé), Max en français");
  await step("Le téléphone enregistre, Groq transcrit, Max répond", async () => {
    await mockStats(true);
    await startSession("fr", "Max");
    await page.waitForSelector(transcript, { timeout: 25000 });
    await page.waitForTimeout(1500);
    await page.evaluate(() => {
      window.__micLevel = 0.6;
    });
    await page.waitForTimeout(1500);
    await page.evaluate(() => {
      window.__micLevel = 0;
    });
    await waitBubble("hier j'ai bu mon café", 25000);
    await waitBubble("après le café", 25000);
    const stats = await mockStats();
    if (!(stats["/openai/v1/audio/transcriptions"] >= 1)) throw new Error(`Groq n'a pas été appelé : ${JSON.stringify(stats)}`);
    await noBlockingError();
  });
  await page.context().close();

  // ------------------------------------------------------------------ V5 : temps réel sur le PC (WebSocket simulé)
  page = await newPage(browser, { "prof-langue:engine": "live", "prof-langue:language": "fr", "prof-langue:mode": "ami" });
  console.log("Temps réel sur le PC (WebSocket simulé), Max en français");
  await step("Le téléphone se connecte au PC, Max parle, Cherif parle, Max répond en flux", async () => {
    await mockStats(true);
    await startSession("fr", "Max");
    await page.waitForSelector(transcript, { timeout: 25000 });
    const header = await page.locator("header").first().textContent();
    if (!/temps réel/.test(header ?? "")) throw new Error(`en-tête : ${header}`);
    await page.waitForTimeout(800);
    await page.evaluate(() => {
      window.__micLevel = 0.6;
    });
    await page.waitForTimeout(1200);
    await page.evaluate(() => {
      window.__micLevel = 0;
    });
    await waitBubble("hier j'ai bu mon café", 20000);
    await waitBubble("après le café", 20000);
    const stats = await mockStats();
    if (!(stats["/pc/live"] >= 1)) throw new Error(`pas de connexion WebSocket au PC : ${JSON.stringify(stats)}`);
    await noBlockingError();
  });
  await step("PC éteint → la séance temps réel bascule toute seule en mode éco", async () => {
    await page.getByRole("button", { name: "Terminer" }).click();
    await page.getByText(/À retenir|Texte de la séance|C'était rapide/).first().waitFor({ timeout: 30000 });
    await page.request.post(`${MOCK}/__pc`, { data: { down: true } });
    try {
      // Le voyant de l'accueil doit le dire tout de suite, sans PowerShell.
      await page.goto(`${BASE}/`);
      await page.getByText(/PC hors ligne/).waitFor({ timeout: 15000 });
      await startSession("fr", "Max");
      await page.getByText(/continue en mode éco/).waitFor({ timeout: 25000 });
      await page.waitForSelector(transcript, { timeout: 25000 });
      const header = await page.locator("header").first().textContent();
      if (!/éco/.test(header ?? "") || /temps réel/.test(header ?? "")) throw new Error(`en-tête : ${header}`);
      await page.evaluate(() => {
        window.__nextSpeech = "hier j'ai regardé un match";
      });
      await waitBubble("après le café", 25000);
      await noBlockingError();
      // L'échec de connexion WebSocket est attendu ici : ce n'est pas une erreur de l'app.
      consoleErrors = consoleErrors.filter((e) => !/WebSocket/.test(e));
    } finally {
      await page.request.post(`${MOCK}/__pc`, { data: { down: false } });
    }
  });
  await step("Répète relit la dernière réplique (mode éco de repli)", async () => {
    await page.getByRole("button", { name: /Répète/ }).click();
    await page.waitForTimeout(600);
    await noBlockingError();
  });
  await step("Terminer la séance de repli sans erreur", async () => {
    await page.getByRole("button", { name: "Terminer" }).click();
    await page.getByText(/À retenir|Texte de la séance|C'était rapide/).first().waitFor({ timeout: 30000 });
    if (consoleErrors.length) throw new Error(consoleErrors.slice(0, 3).join(" | "));
  });
  await step("Voyant PC : « Revérifier » force la question malgré le disjoncteur → PC en ligne, temps réel prêt", async () => {
    await page.goto(`${BASE}/`);
    const indicator = page.getByRole("status").filter({ hasText: /^PC/ });
    await indicator.getByText(/PC hors ligne|PC en ligne/).waitFor({ timeout: 15000 });
    // Le serveur tient le PC pour éteint pendant 60 s après la panne simulée : le bouton doit passer outre.
    await indicator.getByRole("button", { name: "Revérifier" }).click();
    await indicator.getByText(/PC en ligne : temps réel prêt/).waitFor({ timeout: 15000 });
    await noBlockingError();
  });
  await page.context().close();

  // ------------------------------------------------------------------ Appui pour parler + voix du téléphone
  page = await newPage(browser, { "prof-langue:engine": "eco", "prof-langue:voice-choice": "phone", "prof-langue:language": "fr", "prof-langue:mode": "ami", "prof-langue:talk-mode": "appui" });
  console.log("Appui pour parler, voix du téléphone, Max en français");
  await step("Maintenir le micro, parler, relâcher → réponse", async () => {
    await startSession("fr", "Max");
    await page.waitForSelector(transcript, { timeout: 25000 });
    await page.waitForTimeout(1500);
    await page.evaluate(() => {
      window.__nextSpeech = "J'ai regardé un film hier soir";
    });
    const mic = page.getByRole("button", { name: /Maintiens pour parler/ });
    await mic.waitFor({ timeout: 10000 });
    const box = await mic.boundingBox();
    if (!box) throw new Error("bouton micro introuvable");
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await page.waitForTimeout(900);
    await page.mouse.up();
    await waitBubble("après le café", 25000);
    const spoken = await page.evaluate(() => window.__spoken.length);
    if (spoken < 1) throw new Error("la voix du téléphone n'a rien lu");
    await noBlockingError();
  });
  await step("Appui pendant que Max réfléchit → avertissement, aucune deuxième prise", async () => {
    const before = await countBubbles("après le café");
    await page.waitForTimeout(1200);
    await page.evaluate(() => {
      window.__nextSpeech = "LENT j'ai aussi mangé du riz";
    });
    const mic = page.getByRole("button", { name: /Maintiens pour parler/ });
    const box = await mic.boundingBox();
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await page.waitForTimeout(900);
    await page.mouse.up();
    await waitBubble("mangé du riz", 10000);
    // Claude (simulé) met 1,5 s : un nouvel appui pendant ce temps doit être refusé avec un message.
    await page.mouse.down();
    await page.getByText(/prépare sa réponse/).waitFor({ timeout: 3000 });
    await page.mouse.up();
    await page.waitForFunction(([sel, t, n]) => Array.from(document.querySelectorAll(sel)).filter((p) => (p.textContent || "").toLowerCase().includes(t)).length > n, [transcript, "après le café", before], { timeout: 20000 });
    const users = await countBubbles("mangé du riz");
    if (users !== 1) throw new Error(`prise de parole comptée ${users} fois`);
    await noBlockingError();
  });
  await page.context().close();
} finally {
  await browser.close();
}

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} étapes réussies`);
if (failed.length) {
  console.log(`Captures des échecs : ${SHOTS}`);
  process.exit(1);
}
