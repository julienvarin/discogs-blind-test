import { useCallback, useSyncExternalStore } from "react";
import type { Field } from "./types";

export type Settings = {
  useApple: boolean;
  useYoutube: boolean;
  excludeCDs: boolean;
  excludeBigCompilations: boolean;
  compilationMaxTracks: number;
  points: Record<Field, number>;
  allFourBonus: number;
  timerSeconds: number;
  /** Multiplier applied to points earned after the timer ran out */
  latePointsFactor: number;
  /** Where in a YouTube video playback starts, as % of its duration */
  ytStartMinPct: number;
  ytStartMaxPct: number;
  /** Max wrong picks per field before it locks */
  maxWrongPerField: number;
  volume: number;
};

export const DEFAULT_SETTINGS: Settings = {
  useApple: true,
  useYoutube: true,
  excludeCDs: true,
  excludeBigCompilations: true,
  compilationMaxTracks: 15,
  points: { track: 5, artist: 3, label: 2, album: 1 },
  allFourBonus: 2,
  timerSeconds: 30,
  latePointsFactor: 0.5,
  ytStartMinPct: 25,
  ytStartMaxPct: 45,
  maxWrongPerField: 3,
  volume: 0.8,
};

const KEY = "dbt:settings:v1";
const listeners = new Set<() => void>();
let current: Settings = load();

function load(): Settings {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<Settings>;
      return { ...DEFAULT_SETTINGS, ...parsed, points: { ...DEFAULT_SETTINGS.points, ...parsed.points } };
    }
  } catch {
    /* ignore */
  }
  return DEFAULT_SETTINGS;
}

export const getSettings = () => current;

export function setSettings(patch: Partial<Settings>) {
  current = { ...current, ...patch };
  try {
    localStorage.setItem(KEY, JSON.stringify(current));
  } catch {
    /* ignore */
  }
  listeners.forEach((l) => l());
}

export function useSettings(): [Settings, (patch: Partial<Settings>) => void] {
  const s = useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    getSettings,
  );
  return [s, useCallback(setSettings, [])];
}

/** Settings that change which releases are eligible (used to invalidate the card queue). */
export const eligibilityKey = (s: Settings) =>
  [s.useApple, s.useYoutube, s.excludeCDs, s.excludeBigCompilations, s.compilationMaxTracks].join("|");
