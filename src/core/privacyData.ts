export type StoredItem = { key: string; purpose: string };
const PREFIX = 'psr-';

export function listStoredItems(storage: Pick<Storage, 'length' | 'key'> = localStorage): StoredItem[] {
  const items: StoredItem[] = [];
  for (let index = 0; index < storage.length; index++) {
    const key = storage.key(index);
    if (!key?.startsWith(PREFIX)) continue;
    const purpose = key.startsWith('psr-position-') ? 'Reading position' : key.startsWith('psr-bookmarks-') ? 'Bookmarks' : key === 'psr-volume-preferences' ? 'Volume preference' : 'Reader preference';
    items.push({ key, purpose });
  }
  return items;
}

export function deleteStoredItem(key: string, storage: Pick<Storage, 'removeItem'> = localStorage): boolean {
  if (!key.startsWith(PREFIX)) return false;
  try { storage.removeItem(key); return true; } catch { return false; }
}

export async function clearBrowserAppData(
  storage: Pick<Storage, 'length' | 'key' | 'removeItem'> = localStorage,
  cacheStorage: CacheStorage | undefined = typeof caches === 'undefined' ? undefined : caches,
  databaseFactory: IDBFactory | undefined = typeof indexedDB === 'undefined' ? undefined : indexedDB,
): Promise<{ localStorageCleared: boolean; cachesCleared: boolean; databasesCleared: boolean }> {
  let localStorageCleared = true; let cachesCleared = true; let databasesCleared = true;
  for (const item of listStoredItems(storage)) if (!deleteStoredItem(item.key, storage)) localStorageCleared = false;
  if (cacheStorage) {
    try {
      for (const name of await cacheStorage.keys()) if (name.startsWith(PREFIX) && !await cacheStorage.delete(name)) cachesCleared = false;
      if ((await cacheStorage.keys()).some(name => name.startsWith(PREFIX))) cachesCleared = false;
    }
    catch { cachesCleared = false; }
  }
  if (databaseFactory && 'databases' in databaseFactory && typeof databaseFactory.databases === 'function') {
    try {
      const databases = await databaseFactory.databases();
      await Promise.all(databases.filter(database => database.name?.startsWith(PREFIX)).map(database => new Promise<void>(resolve => {
        const request = databaseFactory.deleteDatabase(database.name!);
        request.onsuccess = () => resolve(); request.onerror = () => { databasesCleared = false; resolve(); }; request.onblocked = () => { databasesCleared = false; resolve(); };
      })));
      if ((await databaseFactory.databases()).some(database => database.name?.startsWith(PREFIX))) databasesCleared = false;
    } catch { databasesCleared = false; }
  }
  localStorageCleared = localStorageCleared && listStoredItems(storage).length === 0;
  return { localStorageCleared, cachesCleared, databasesCleared };
}
