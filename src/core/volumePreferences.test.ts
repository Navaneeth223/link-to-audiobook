import { describe, expect, it } from 'vitest';
import { loadVolumePreferences, saveVolumePreferences, VOLUME_PREFERENCES_KEY } from './volumePreferences';

describe('volume preferences', () => {
  it('persists volume, mute and last non-zero setting across reloads', () => {
    const memory = new Map<string, string>();
    const storage = { getItem: (key: string) => memory.get(key) ?? null, setItem: (key: string, value: string) => { memory.set(key, value); } };
    saveVolumePreferences({ volume: 0.43, muted: true, lastNonZero: 0.82 }, storage);
    expect(loadVolumePreferences(storage)).toEqual({ volume: 0.43, muted: true, lastNonZero: 0.82 });
    expect(memory.has(VOLUME_PREFERENCES_KEY)).toBe(true);
  });

  it('restores safely and clamps malformed values', () => {
    const storage = { getItem: () => '{"volume":4,"muted":false,"lastNonZero":-1}' };
    expect(loadVolumePreferences(storage)).toEqual({ volume: 1, muted: false, lastNonZero: 0.7 });
  });
});
