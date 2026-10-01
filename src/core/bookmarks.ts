import type { Story } from './document';

export type Bookmark = {
  id: string;
  documentFingerprint: string;
  chapterId: string;
  paragraphId: string;
  sentenceIndex: number;
  audioTimeEstimate: number;
  userLabel: string;
  createdAt: number;
};

// A stable, content-derived identifier lets local locators follow a document
// between reloads without storing its text in the bookmark record.
export function documentFingerprint(story: Pick<Story, 'text'>): string {
  let hash = 0xcbf29ce484222325n;
  for (const char of story.text) {
    hash ^= BigInt(char.codePointAt(0) ?? 0);
    hash = BigInt.asUintN(64, hash * 0x100000001b3n);
  }
  return `fnv1a64-${hash.toString(16).padStart(16, '0')}`;
}

export function bookmarkStorageKey(fingerprint: string): string { return `psr-bookmarks-${fingerprint}`; }

export function parseBookmarks(value: unknown, fingerprint: string, story?: Story): Bookmark[] {
  if (!Array.isArray(value)) return [];
  return value.filter((entry): entry is Bookmark => {
    if (!entry || typeof entry !== 'object') return false;
    const item = entry as Partial<Bookmark>;
    return typeof item.id === 'string' && item.documentFingerprint === fingerprint &&
      typeof item.chapterId === 'string' && typeof item.paragraphId === 'string' &&
      Number.isInteger(item.sentenceIndex) && Number.isFinite(item.audioTimeEstimate) &&
      typeof item.userLabel === 'string' && Number.isFinite(item.createdAt) &&
      (!story || story.chapters.some(chapter => chapter.id === item.chapterId && chapter.paragraphs.some(paragraph => paragraph.id === item.paragraphId)));
  });
}

export function migrateLegacyBookmarks(value: unknown, story: Story): Bookmark[] {
  if (!Array.isArray(value)) return [];
  const fingerprint = documentFingerprint(story);
  return value.flatMap(entry => {
    if (!entry || typeof entry !== 'object') return [];
    const old = entry as { id?: unknown; name?: unknown; chapterIndex?: unknown; paragraphIndex?: unknown };
    if (typeof old.id !== 'string' || typeof old.name !== 'string' || !Number.isInteger(old.chapterIndex) || !Number.isInteger(old.paragraphIndex)) return [];
    const chapter = story.chapters[old.chapterIndex as number];
    const paragraph = chapter?.paragraphs[old.paragraphIndex as number];
    if (!chapter || !paragraph) return [];
    return [{ id: old.id, documentFingerprint: fingerprint, chapterId: chapter.id, paragraphId: paragraph.id, sentenceIndex: 0, audioTimeEstimate: 0, userLabel: old.name, createdAt: Date.now() }];
  });
}

export function loadBookmarks(fingerprint: string, story: Story, storage: Pick<Storage, 'getItem' | 'removeItem'> = localStorage): Bookmark[] {
  const key = bookmarkStorageKey(fingerprint);
  try {
    const saved = storage.getItem(key);
    return saved ? parseBookmarks(JSON.parse(saved), fingerprint, story) : [];
  } catch {
    try { storage.removeItem(key); } catch { /* Storage may be disabled. */ }
    return [];
  }
}

export function saveBookmarks(fingerprint: string, bookmarks: Bookmark[], storage: Pick<Storage, 'setItem'> = localStorage): void {
  try { storage.setItem(bookmarkStorageKey(fingerprint), JSON.stringify(bookmarks)); } catch { /* Storage may be full or disabled. */ }
}
