import { Asset } from "expo-asset";

// Web-only audio engine for the ambient sound feature. Two hard platform
// restrictions in mobile Safari make expo-av's plain web fallback
// unreliable there, which is what this file works around:
//
// 1. iOS Safari makes HTMLMediaElement.volume a permanent no-op — Apple
//    disabled programmatic volume control by design, only the hardware
//    buttons work. Piping the element through the Web Audio API and
//    controlling a GainNode instead DOES work, since it operates on the
//    decoded audio signal rather than the (locked) element property.
// 2. Safari's autoplay policy requires playback to start within (or very
//    close to) the original user gesture. Every function here is called
//    directly from a tap handler — no intermediate React effect/state
//    round-trip — to stay inside that window.
//
// One persistent <audio> element + GainNode for the looping background
// track, and a second pair for the short preview clips, both sharing one
// AudioContext. Elements are created lazily (first call) since
// AudioContext can't be constructed before a user gesture on some
// browsers either.

let audioCtx: AudioContext | null = null;
let loopEl: HTMLAudioElement | null = null;
let loopGain: GainNode | null = null;
let previewEl: HTMLAudioElement | null = null;
let previewGain: GainNode | null = null;

function getAudioContext(): AudioContext {
  if (!audioCtx) {
    const Ctor = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    audioCtx = new Ctor();
  }
  return audioCtx;
}

function ensureLoopGraph(): { el: HTMLAudioElement; gain: GainNode } {
  if (!loopEl) {
    loopEl = new window.Audio();
    loopEl.loop = true;
    const ctx = getAudioContext();
    const source = ctx.createMediaElementSource(loopEl);
    loopGain = ctx.createGain();
    source.connect(loopGain).connect(ctx.destination);
  }
  return { el: loopEl, gain: loopGain! };
}

function ensurePreviewGraph(): { el: HTMLAudioElement; gain: GainNode } {
  if (!previewEl) {
    previewEl = new window.Audio();
    const ctx = getAudioContext();
    const source = ctx.createMediaElementSource(previewEl);
    previewGain = ctx.createGain();
    source.connect(previewGain).connect(ctx.destination);
  }
  return { el: previewEl, gain: previewGain! };
}

function resolveSourceUri(source: number): string {
  return Asset.fromModule(source).uri;
}

export async function playLoop(source: number, volume: number): Promise<void> {
  const { el, gain } = ensureLoopGraph();
  const ctx = getAudioContext();
  if (ctx.state === "suspended") await ctx.resume().catch(() => {});
  const uri = resolveSourceUri(source);
  if (el.src !== uri) el.src = uri;
  gain.gain.value = volume;
  await el.play();
}

export function pauseLoop(): void {
  loopEl?.pause();
}

export function setLoopVolume(volume: number): void {
  if (loopGain) loopGain.gain.value = volume;
}

export async function playPreview(source: number, volume: number, onEnded: () => void): Promise<void> {
  const { el, gain } = ensurePreviewGraph();
  const ctx = getAudioContext();
  if (ctx.state === "suspended") await ctx.resume().catch(() => {});
  el.pause();
  el.currentTime = 0;
  el.src = resolveSourceUri(source);
  gain.gain.value = volume;
  el.onended = onEnded;
  await el.play();
}

export function stopPreview(): void {
  if (previewEl) {
    previewEl.onended = null;
    previewEl.pause();
    previewEl.currentTime = 0;
  }
}
