"use client";

import { downsample } from "@/lib/recorder";

/**
 * Micro en flux pour le mode temps réel : le son part vers le PC par petits
 * morceaux (16 kHz, mono, 16 bits), au fur et à mesure. L'annulation d'écho du
 * téléphone est activée pour que le micro n'entende pas trop le personnage.
 */
export type MicStream = { stop: () => void };

const TARGET_RATE = 16000;

export async function startMicStream(
  onFrame: (pcm: Int16Array) => void,
  onLevel?: (level: number) => void,
  /** Contexte audio à partager avec la lecture (meilleure annulation d'écho) ; sinon un contexte à part. */
  sharedContext?: AudioContext,
): Promise<MicStream> {
  if (typeof navigator === "undefined" || !navigator.mediaDevices?.getUserMedia)
    throw new Error("Ce navigateur ne donne pas accès au micro.");
  const stream = await navigator.mediaDevices.getUserMedia({
    audio: {
      channelCount: 1,
      echoCancellation: true,
      noiseSuppression: true,
      autoGainControl: true,
    },
  });
  const Ctx =
    window.AudioContext ??
    (window as unknown as { webkitAudioContext?: typeof AudioContext })
      .webkitAudioContext;
  if (!Ctx) {
    stream.getTracks().forEach((t) => t.stop());
    throw new Error("Ce navigateur ne sait pas traiter le son.");
  }
  const ctx = sharedContext ?? new Ctx();
  const ownsContext = !sharedContext;
  if (ctx.state === "suspended") await ctx.resume().catch(() => undefined);
  const source = ctx.createMediaStreamSource(stream);
  const processor = ctx.createScriptProcessor(4096, 1, 1);
  const silent = ctx.createGain();
  silent.gain.value = 0;
  let stopped = false;
  processor.onaudioprocess = (event) => {
    if (stopped) return;
    const input = event.inputBuffer.getChannelData(0);
    if (onLevel) {
      let sum = 0;
      for (let i = 0; i < input.length; i += 8) sum += input[i] * input[i];
      onLevel(Math.min(1, Math.sqrt(sum / (input.length / 8)) * 4));
    }
    const down = downsample(input, ctx.sampleRate, TARGET_RATE);
    const pcm = new Int16Array(down.length);
    for (let i = 0; i < down.length; i++) {
      const s = Math.max(-1, Math.min(1, down[i]));
      pcm[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
    }
    onFrame(pcm);
  };
  source.connect(processor);
  processor.connect(silent);
  silent.connect(ctx.destination);
  return {
    stop: () => {
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
      if (ownsContext) void ctx.close().catch(() => undefined);
    },
  };
}
