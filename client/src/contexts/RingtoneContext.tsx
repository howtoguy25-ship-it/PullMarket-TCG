import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import { Audio } from "expo-av";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { DEFAULT_RINGTONE_ID, getRingtoneById } from "@/lib/ringtones";

const STORAGE_KEY = "pullmarket_ringtone_pref";

interface RingtoneContextValue {
  selectedId: string;
  previewingId: string | null;
  selectRingtone: (id: string) => void;
  preview: (id: string) => void;
  /** Starts the selected ringtone looping — used by CallContext when an
   * incoming call arrives. Returns a stop function. */
  startIncomingRingtone: () => Promise<() => void>;
}

const RingtoneContext = createContext<RingtoneContextValue | null>(null);

export function RingtoneProvider({ children }: { children: React.ReactNode }) {
  const [selectedId, setSelectedId] = useState(DEFAULT_RINGTONE_ID);
  const [previewingId, setPreviewingId] = useState<string | null>(null);
  const selectedIdRef = useRef(selectedId);
  selectedIdRef.current = selectedId;

  const previewSoundRef = useRef<Audio.Sound | null>(null);
  const incomingSoundRef = useRef<Audio.Sound | null>(null);

  useEffect(() => {
    AsyncStorage.getItem(STORAGE_KEY)
      .then((raw) => {
        if (raw) setSelectedId(raw);
      })
      .catch(() => {});
    return () => {
      previewSoundRef.current?.unloadAsync().catch(() => {});
      incomingSoundRef.current?.unloadAsync().catch(() => {});
    };
  }, []);

  const selectRingtone = useCallback((id: string) => {
    setSelectedId(id);
    AsyncStorage.setItem(STORAGE_KEY, id).catch(() => {});
  }, []);

  const preview = useCallback(async (id: string) => {
    if (previewSoundRef.current) {
      await previewSoundRef.current.unloadAsync().catch(() => {});
      previewSoundRef.current = null;
    }
    setPreviewingId(id);
    try {
      const { sound } = await Audio.Sound.createAsync(getRingtoneById(id).source, { shouldPlay: true, volume: 0.9 });
      previewSoundRef.current = sound;
      sound.setOnPlaybackStatusUpdate((status) => {
        if (status.isLoaded && status.didJustFinish) {
          setPreviewingId((cur) => (cur === id ? null : cur));
          sound.unloadAsync().catch(() => {});
          if (previewSoundRef.current === sound) previewSoundRef.current = null;
        }
      });
    } catch {
      setPreviewingId(null);
    }
  }, []);

  // Called from CallContext the moment an incoming call arrives — loads and
  // loops the user's chosen ringtone in place of the OS system ringtone.
  // The returned stop function is idempotent and safe to call more than
  // once (answered/declined/missed/ended can all race to stop it).
  const startIncomingRingtone = useCallback(async () => {
    const source = getRingtoneById(selectedIdRef.current).source;
    let sound: Audio.Sound | null = null;
    try {
      const result = await Audio.Sound.createAsync(source, { shouldPlay: true, isLooping: true, volume: 1 });
      sound = result.sound;
      incomingSoundRef.current = sound;
    } catch {
      sound = null;
    }
    let stopped = false;
    return () => {
      if (stopped || !sound) return;
      stopped = true;
      sound.stopAsync().catch(() => {});
      sound.unloadAsync().catch(() => {});
      if (incomingSoundRef.current === sound) incomingSoundRef.current = null;
    };
  }, []);

  return <RingtoneContext.Provider value={{ selectedId, previewingId, selectRingtone, preview, startIncomingRingtone }}>{children}</RingtoneContext.Provider>;
}

export function useRingtone() {
  const ctx = useContext(RingtoneContext);
  if (!ctx) throw new Error("useRingtone must be used within RingtoneProvider");
  return ctx;
}
