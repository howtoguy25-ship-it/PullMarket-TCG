import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import { Audio } from "expo-av";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { AMBIENT_SOUNDS, DEFAULT_AMBIENT_SOUND_ID } from "@/lib/ambientSounds";

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

  const loopSoundRef = useRef<Audio.Sound | null>(null);
  const previewSoundRef = useRef<Audio.Sound | null>(null);
  const loaded = useRef(false);

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
      loopSoundRef.current?.unloadAsync();
      previewSoundRef.current?.unloadAsync();
    };
  }, []);

  const persist = useCallback((prefs: StoredPrefs) => {
    AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(prefs)).catch(() => {});
  }, []);

  // (Re)start the looping background sound whenever enabled/selection changes.
  useEffect(() => {
    if (!loaded.current) return;
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

  // Keep volume in sync on the currently-playing loop without restarting it.
  useEffect(() => {
    loopSoundRef.current?.setVolumeAsync(volume).catch(() => {});
  }, [volume]);

  const setEnabled = useCallback(
    (next: boolean) => {
      setEnabledState(next);
      persist({ enabled: next, selectedId, volume });
    },
    [persist, selectedId, volume],
  );

  const selectSound = useCallback(
    (id: string) => {
      setSelectedId(id);
      persist({ enabled, selectedId: id, volume });
    },
    [persist, enabled, volume],
  );

  const setVolume = useCallback(
    (next: number) => {
      setVolumeState(next);
      persist({ enabled, selectedId, volume: next });
    },
    [persist, enabled, selectedId],
  );

  const previewTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const PREVIEW_DURATION_MS = 12_000;

  const stopPreview = useCallback(async () => {
    if (previewTimeoutRef.current) {
      clearTimeout(previewTimeoutRef.current);
      previewTimeoutRef.current = null;
    }
    if (previewSoundRef.current) {
      const sound = previewSoundRef.current;
      previewSoundRef.current = null;
      await sound.stopAsync().catch(() => {});
      await sound.unloadAsync().catch(() => {});
    }
    setPreviewingId(null);
    // Resume the background loop (it was ducked, not stopped, while previewing).
    if (loopSoundRef.current) await loopSoundRef.current.setVolumeAsync(volume).catch(() => {});
  }, [volume]);

  const preview = useCallback(
    async (id: string) => {
      // Tapping the currently-previewing track again stops it early.
      if (previewingId === id) {
        await stopPreview();
        return;
      }
      const option = AMBIENT_SOUNDS.find((s) => s.id === id);
      if (!option) return;
      await stopPreview();
      // Duck the background loop instead of stopping it, so previewing a
      // track doesn't cut the currently-playing ambience out entirely.
      if (loopSoundRef.current) await loopSoundRef.current.setVolumeAsync(volume * 0.15).catch(() => {});
      setPreviewingId(id);
      const { sound } = await Audio.Sound.createAsync(option.source, { volume, shouldPlay: true });
      previewSoundRef.current = sound;
      sound.setOnPlaybackStatusUpdate((status) => {
        if (status.isLoaded && status.didJustFinish) void stopPreview();
      });
      previewTimeoutRef.current = setTimeout(() => void stopPreview(), PREVIEW_DURATION_MS);
    },
    [volume, previewingId, stopPreview],
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
