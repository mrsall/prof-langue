"use client";

/**
 * Enregistreur WAV côté téléphone : capte le micro, ramène le son à 16 kHz mono
 * et fabrique un fichier WAV PCM 16 bits, le format que l'évaluation de
 * prononciation accepte partout (y compris sur iPhone, où MediaRecorder ne
 * sait pas produire ce format).
 */

export type WavRecorder = {
  /** Arrête l'enregistrement et renvoie le WAV. */
  stop: () => Promise<Blob>;
  /** Abandonne sans rien renvoyer. */
  cancel: () => void;
};

const TARGET_RATE = 16000;

export async function startWavRecorder(onLevel?: (level: number) => void): Promise<WavRecorder> {
  if (typeof navigator === "undefined" || !navigator.mediaDevices?.getUserMedia) {
    throw new Error("Ce navigateur ne donne pas accès au micro.");
  }
  const stream = await navigator.mediaDevices.getUserMedia({
    audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true },
  });
  const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!Ctx) {
    stream.getTracks().forEach((t) => t.stop());
    throw new Error("Ce navigateur ne sait pas traiter le son.");
  }
  const ctx = new Ctx();
  if (ctx.state === "suspended") await ctx.resume().catch(() => undefined);
  const source = ctx.createMediaStreamSource(stream);
  const processor = ctx.createScriptProcessor(4096, 1, 1);
  const silent = ctx.createGain();
  silent.gain.value = 0;
  const chunks: Float32Array[] = [];
  let stopped = false;

  processor.onaudioprocess = (event) => {
    if (stopped) return;
    const input = event.inputBuffer.getChannelData(0);
    chunks.push(new Float32Array(input));
    if (onLevel) {
      let sum = 0;
      for (let i = 0; i < input.length; i += 8) sum += input[i] * input[i];
      onLevel(Math.min(1, Math.sqrt(sum / (input.length / 8)) * 4));
    }
  };
  source.connect(processor);
  processor.connect(silent);
  silent.connect(ctx.destination);

  const teardown = () => {
    stopped = true;
    processor.onaudioprocess = null;
    try {
      source.disconnect();
      processor.disconnect();
      silent.disconnect();
    } catch {
      // déjà déconnecté
    }
    stream.getTracks().forEach((t) => t.stop());
    void ctx.close().catch(() => undefined);
  };

  return {
    stop: async () => {
      const rate = ctx.sampleRate;
      teardown();
      const merged = mergeChunks(chunks);
      const down = downsample(merged, rate, TARGET_RATE);
      return encodeWav(down, TARGET_RATE);
    },
    cancel: teardown,
  };
}

function mergeChunks(chunks: Float32Array[]) {
  const total = chunks.reduce((n, c) => n + c.length, 0);
  const out = new Float32Array(total);
  let offset = 0;
  for (const c of chunks) {
    out.set(c, offset);
    offset += c.length;
  }
  return out;
}

/** Moyenne glissante simple : suffisant pour la voix, et léger pour le téléphone. */
function downsample(input: Float32Array, fromRate: number, toRate: number) {
  if (fromRate === toRate) return input;
  const ratio = fromRate / toRate;
  const length = Math.floor(input.length / ratio);
  const out = new Float32Array(length);
  let pos = 0;
  for (let i = 0; i < length; i++) {
    const next = Math.min(input.length, Math.round((i + 1) * ratio));
    let sum = 0;
    let n = 0;
    for (let j = pos; j < next; j++) {
      sum += input[j];
      n++;
    }
    out[i] = n > 0 ? sum / n : 0;
    pos = next;
  }
  return out;
}

function encodeWav(samples: Float32Array, sampleRate: number) {
  const buffer = new ArrayBuffer(44 + samples.length * 2);
  const view = new DataView(buffer);
  const writeString = (offset: number, s: string) => {
    for (let i = 0; i < s.length; i++) view.setUint8(offset + i, s.charCodeAt(i));
  };
  writeString(0, "RIFF");
  view.setUint32(4, 36 + samples.length * 2, true);
  writeString(8, "WAVE");
  writeString(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  writeString(36, "data");
  view.setUint32(40, samples.length * 2, true);
  let offset = 44;
  for (let i = 0; i < samples.length; i++, offset += 2) {
    const s = Math.max(-1, Math.min(1, samples[i]));
    view.setInt16(offset, s < 0 ? s * 0x8000 : s * 0x7fff, true);
  }
  return new Blob([buffer], { type: "audio/wav" });
}
