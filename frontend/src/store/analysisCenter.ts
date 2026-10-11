import { create } from "zustand";

const STORAGE_KEY = "qz.analysis-center.v1";
const RECENT_LIMIT = 12;
const FAVORITE_LIMIT = 100;
const ID_LIMIT = 128;

interface StoredPreferences {
  favorites: string[];
  recent: string[];
}

interface AnalysisCenterState extends StoredPreferences {
  toggleFavorite: (id: string) => void;
  recordUse: (id: string) => void;
}

function strings(value: unknown, limit: number): string[] {
  return Array.isArray(value)
    ? [...new Set(value.filter((item): item is string => typeof item === "string" && item.length > 0 && item.length <= ID_LIMIT))].slice(0, limit)
    : [];
}

function load(): StoredPreferences {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { favorites: [], recent: [] };
    const parsed = JSON.parse(raw) as { favorites?: unknown; recent?: unknown };
    return { favorites: strings(parsed.favorites, FAVORITE_LIMIT), recent: strings(parsed.recent, RECENT_LIMIT) };
  } catch {
    return { favorites: [], recent: [] };
  }
}

function save(preferences: StoredPreferences): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(preferences));
  } catch {
    // A blocked/full preference store must never block scientific work.
  }
}

const initial = load();

export const useAnalysisCenter = create<AnalysisCenterState>((set) => ({
  ...initial,
  toggleFavorite: (id) => set((state) => {
    const favorites = state.favorites.includes(id)
      ? state.favorites.filter((entry) => entry !== id)
      : [...state.favorites, id];
    save({ favorites, recent: state.recent });
    return { favorites };
  }),
  recordUse: (id) => set((state) => {
    const recent = [id, ...state.recent.filter((entry) => entry !== id)].slice(0, RECENT_LIMIT);
    save({ favorites: state.favorites, recent });
    return { recent };
  }),
}));

export function resetAnalysisCenterPreferencesForTests(): void {
  localStorage.removeItem(STORAGE_KEY);
  useAnalysisCenter.setState({ favorites: [], recent: [] });
}
