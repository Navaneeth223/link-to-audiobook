import { describe, expect, it } from 'vitest';
import { bookmarkStorageKey, documentFingerprint, loadBookmarks, migrateLegacyBookmarks, parseBookmarks, saveBookmarks, type Bookmark } from './bookmarks';
import type { Story } from './document';

const story = { id: 's', title: 'title', sourceName: 'story.txt', text: 'private story text', createdAt: 0, chapters: [{ id: 'c1', title: 'Part', paragraphs: [{ id: 'p1', text: 'A sentence.' }] }] } satisfies Story;

describe('bookmark persistence', () => {
  it('uses a stable content fingerprint and stores locators without story text', () => {
    const fingerprint = documentFingerprint(story);
    expect(documentFingerprint({ text: story.text })).toBe(fingerprint);
    expect(documentFingerprint({ text: `${story.text}!` })).not.toBe(fingerprint);
    const bookmark: Bookmark = { id: 'b1', documentFingerprint: fingerprint, chapterId: 'c1', paragraphId: 'p1', sentenceIndex: 0, audioTimeEstimate: 12, userLabel: 'Pause', createdAt: 100 };
    const memory = new Map<string, string>();
    const storage = { getItem: (key: string) => memory.get(key) ?? null, setItem: (key: string, value: string) => { memory.set(key, value); }, removeItem: (key: string) => memory.delete(key) };
    saveBookmarks(fingerprint, [bookmark], storage);
    expect(memory.get(bookmarkStorageKey(fingerprint))).not.toContain(story.text);
    expect(loadBookmarks(fingerprint, story, storage)).toEqual([bookmark]);
    expect(parseBookmarks([{ ...bookmark, paragraphId: 'missing' }], fingerprint, story)).toEqual([]);
  });
  it('migrates older index bookmarks into content locators', () => {
    expect(migrateLegacyBookmarks([{ id: 'old', name: 'Old label', chapterIndex: 0, paragraphIndex: 0 }], story)[0]).toMatchObject({ id: 'old', documentFingerprint: documentFingerprint(story), chapterId: 'c1', paragraphId: 'p1', sentenceIndex: 0, userLabel: 'Old label' });
  });
});
