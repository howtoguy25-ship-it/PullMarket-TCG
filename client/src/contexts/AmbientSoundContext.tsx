import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import { Platform } from "react-native";
import { Audio } from "expo-av";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { AMBIENT_SOUNDS, DEFAULT_AMBIENT_SOUND_ID } from "@/lib/ambientSounds";
import * as webAudio from "@/lib/webAmbientAudio";

const IS_WEB = Platform.OS === "web";
const STORAGE_KEY = "pullmarket_ambient_sound_prefs";

interface StoredPrefs {
  enabled: boolean;
  selectedId: string;
  volume: number;
}

interface AmbientSoundContextValue {
  enabled: boolean;
  selectedId: string;
  volume: number;
  previewingId: string | null;
  setEnabled: (enabled: boolean) => void;
  selectSound: (id: string) => void;
  setVolume: (volume: number) => void;
  preview: (id: string) => void;
}

const AmbientSoundContext = createContext<AmbientSoundContextValue | null>(null);

export function AmbientSoundProvider({ children }: { children: React.ReactNode }) {
  const [enabled, setEnabledState] = useState(false);
  const [selectedId, setSelectedId] = useState(DEFAULT_AMBIENT_SOUND_ID);
  const [volume, setVolumeState] = useState(0.6);
  const [previewingId, setPreviewingId] = useState<string | null>(null);

  // Native-only: expo-av Sound objects for the loop/preview. The web path
  // uses lib/webAmbientAudio instead — see the comments on setEnabled below
  // for why they're not unified behind one code path.
  const loopSoundRef = useRef<Audio.Sound | null>(null);
  const previewSoundRef = useRef<Audio.Sound | null>(null);
  const loaded = useRef(false);

  // Mirrored into refs so the web-path handlers (which call the audio
  // engine directly, not through an effect keyed on state) always act on
  // the latest values without needing to be recreated every render.
  const enabledRef = useRef(enabled);
  const selectedIdRef = useRef(selectedId);
  const volumeRef = useRef(volume);
  enabledRef.current = enabled;
  selectedIdRef.current = selectedId;
  volumeRef.current = volume;

  // Load persisted preferences once on mount.
  useEffect(() => {
    (async () => {
      try {
        const raw = await AsyncStorage.getItem(STORAGE_KEY);
        if (raw) {
          const prefs: StoredPrefs = JSON.parse(raw);
          setEnabledState(prefs.enabled);
          setSelectedId(prefs.selectedId);
          setVolumeState(prefs.volume);
        }
      } finally {
        loaded.current = true;
      }
    })();
    return () => {
      if (IS_WEB) {
        webAudio.pauseLoop();
        webAudio.stopPreview();
      } else {
        loopSoundRef.current?.unloadAsync();
        previewSoundRef.current?.unloadAsync();
      }
    };
  }, []);

  const persist = useCallback((prefs: StoredPrefs) => {
    AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(prefs)).catch(() => {});
  }, []);

  // Native only: (re)start the looping background sound whenever
  // enabled/selection changes, via expo-av. The web path does NOT use this
  // effect — see setEnabled/selectSound below: Safari only allows play() to
  // succeed within (or very close to) the original user gesture, and
  // routing playback through a render → effect → async-load chain (as this
  // effect does) reliably loses that window, which is why the background
  // toggle, track switching, and preview all silently failed on web before.
  useEffect(() => {
    if (IS_WEB || !loaded.current) return;
    let cancelled = false;

    (async () => {
      if (loopSoundRef.current) {
        await loopSoundRef.current.unloadAsync();
        loopSoundRef.current = null;
      }
      if (!enabled) return;

      const option = AMBIENT_SOUNDS.find((s) => s.id === selectedId) ?? AMBIENT_SOUNDS[0];
      const { sound } = await Audio.Sound.createAsync(option.source, { isLooping: true, volume });
      if (cancelled) {
        await sound.unloadAsync();
        return;
      }
      loopSoundRef.current = sound;
      await sound.playAsync();
    })();

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, selectedId]);

  // Native only: keep volume in sync on the currently-playing loop without
  // restarting it. Web's volume changes happen directly in setVolume below.
  useEffect(() => {
    if (IS_WEB) return;
    loopSoundRef.current?.setVolumeAsync(volume).catch(() => {});
  }, [volume]);

  const setEnabled = useCallback(
    (next: boolean) => {
      setEnabledState(next);
      persist({ enabled: next, selectedId: selectedIdRef.current, volume: volumeRef.current });
      if (IS_WEB) {
        if (next) {
          const option = AMBIENT_SOUNDS.find((s) => s.id === selectedIdRef.current) ?? AMBIENT_SOUNDS[0];
          void webAudio.playLoop(option.source, volumeRef.current).catch((err) => console.warn("[ambient] loop play failed", err));
        } else {
          webAudio.pauseLoop();
        }
      }
    },
    [persist],
  );

  const selectSound = useCallback(
    (id: string) => {
      setSelectedId(id);
      persist({ enabled: enabledRef.current, selectedId: id, volume: volumeRef.current });
      if (IS_WEB && enabledRef.current) {
        const option = AMBIENT_SOUNDS.find((s) => s.id === id);
        if (option) void webAudio.playLoop(option.source, volumeRef.current).catch((err) => console.warn("[ambient] loop switch failed", err));
      }
    },
    [persist],
  );

  const setVolume = useCallback(
    (next: number) => {
      setVolumeState(next);
      persist({ enabled: enabledRef.current, selectedId: selectedIdRef.current, volume: next });
      // Routed through a Web Audio GainNode (see webAmbientAudio.ts) — iOS
      // Safari makes the plain HTMLMediaElement.volume property a no-op by
      // design, so setting it directly (what this used to do, and what the
      // native expo-av path above still correctly does) silently did
      // nothing on that one platform.
      if (IS_WEB) webAudio.setLoopVolume(next);
    },
    [persist],
  );

  const previewTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const PREVIEW_DURATION_MS = 12_000;

  const stopPreview = useCallback(async () => {
    if (previewTimeoutRef.current) {
      clearTimeout(previewTimeoutRef.current);
      previewTimeoutRef.current = null;
    }
    if (IS_WEB) {
      webAudio.stopPreview();
    } else if (previewSoundRef.current) {
      const sound = previewSoundRef.current;
      previewSoundRef.current = null;
      await sound.stopAsync().catch(() => {});
      await sound.unloadAsync().catch(() => {});
    }
    setPreviewingId(null);
    // Resume the background loop's volume (it was ducked, not stopped, while previewing).
    if (IS_WEB) {
      webAudio.setLoopVolume(volumeRef.current);
    } else if (loopSoundRef.current) {
      await loopSoundRef.current.setVolumeAsync(volumeRef.current).catch(() => {});
    }
  }, []);

  const preview = useCallback(
    (id: string) => {
      // Tapping the currently-previewing track again stops it early.
      if (previewingId === id) {
        void stopPreview();
        return;
      }
      const option = AMBIENT_SOUNDS.find((s) => s.id === id);
      if (!option) return;

      void stopPreview().then(async () => {
        // Duck the background loop instead of stopping it, so previewing a
        // track doesn't cut the currently-playing ambience out entirely.
        if (IS_WEB) {
          webAudio.setLoopVolume(volumeRef.current * 0.15);
          setPreviewingId(id);
          try {
            await webAudio.playPreview(option.source, volumeRef.current, () => void stopPreview());
          } catch (err) {
            console.warn("[ambient] preview play failed", err);
            setPreviewingId(null);
            return;
          }
        } else {
          if (loopSoundRef.current) await loopSoundRef.current.setVolumeAsync(volumeRef.current * 0.15).catch(() => {});
          setPreviewingId(id);
          const { sound } = await Audio.Sound.createAsync(option.source, { volume: volumeRef.current, shouldPlay: true });
          previewSoundRef.current = sound;
          sound.setOnPlaybackStatusUpdate((status) => {
            if (status.isLoaded && status.didJustFinish) void stopPreview();
          });
        }
        previewTimeoutRef.current = setTimeout(() => void stopPreview(), PREVIEW_DURATION_MS);
      });
    },
    [previewingId, stopPreview],
  );

  return (
    <AmbientSoundContext.Provider value={{ enabled, selectedId, volume, previewingId, setEnabled, selectSound, setVolume, preview }}>
      {children}
    </AmbientSoundContext.Provider>
  );
}

export function useAmbientSound(): AmbientSoundContextValue {
  const ctx = useContext(AmbientSoundContext);
  if (!ctx) throw new Error("useAmbientSound must be used within AmbientSoundProvider");
  return ctx;
}
