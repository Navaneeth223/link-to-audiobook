import { describe, expect, it } from 'vitest';
import { clearBrowserAppData, deleteStoredItem, listStoredItems } from './privacyData';

describe('local privacy data controls', () => {
  it('lists purpose only, removes individual app data, and keeps unrelated site data', async () => {
    const values = new Map([
      ['psr-bookmarks-doc', '[{"userLabel":"Pause"}]'],
      ['psr-volume-preferences', '{"volume":0.5}'],
      ['other-app', 'keep'],
    ]);
    const storage = {
      get length() {
        return values.size;
      },
      key: (index: number) => [...values.keys()][index] ?? null,
      removeItem: (key: string) => {
        values.delete(key);
      },
    };
    expect(listStoredItems(storage).map((item) => item.purpose)).toEqual(['Bookmarks', 'Volume preference']);
    expect(deleteStoredItem('other-app', storage)).toBe(false);
    expect(deleteStoredItem('psr-bookmarks-doc', storage)).toBe(true);
    const result = await clearBrowserAppData(storage, undefined, undefined, undefined);
    expect(result.localStorageCleared).toBe(true);
    expect(result.opfsCleared).toBe(true);
    expect(values.has('other-app')).toBe(true);
  });
});
