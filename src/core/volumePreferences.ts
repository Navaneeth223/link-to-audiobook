import { clampVolume } from './speech';

export const VOLUME_PREFERENCES_KEY = 'psr-volume-preferences';
export type VolumePreferences = { volume: number; muted: boolean; lastNonZero: number };
export const DEFAULT_VOLUME_PREFERENCES: VolumePreferences = { volume: 0.7, muted: false, lastNonZero: 0.7 };

export function loadVolumePreferences(storage: Pick<Storage, 'getItem'> = localStorage): VolumePreferences {
  try {
    const raw = storage.getItem(VOLUME_PREFERENCES_KEY);
    if (!raw) return { ...DEFAULT_VOLUME_PREFERENCES };
    const saved: unknown = JSON.parse(raw);
    if (!saved || typeof saved !== 'object') return { ...DEFAULT_VOLUME_PREFERENCES };
    const values = saved as Partial<VolumePreferences>;
    const volume = clampVolume(typeof values.volume === 'number' ? values.volume : DEFAULT_VOLUME_PREFERENCES.volume);
    const lastNonZero = clampVolume(typeof values.lastNonZero === 'number' ? values.lastNonZero : volume || DEFAULT_VOLUME_PREFERENCES.lastNonZero);
    return { volume, lastNonZero: lastNonZero || DEFAULT_VOLUME_PREFERENCES.lastNonZero, muted: values.muted === true || volume === 0 };
  } catch { return { ...DEFAULT_VOLUME_PREFERENCES }; }
}

export function saveVolumePreferences(preferences: VolumePreferences, storage: Pick<Storage, 'setItem'> = localStorage): void {
  try { storage.setItem(VOLUME_PREFERENCES_KEY, JSON.stringify(preferences)); } catch { /* Storage can be unavailable in private browsing. */ }
}
