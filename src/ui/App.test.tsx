import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import App from './App';
import { documentFingerprint } from '../core/bookmarks';
import { extractFile } from '../core/document';

const { loadedStory } = vi.hoisted(() => ({ loadedStory: {
  id: 'paper-garden', title: 'The Paper Garden', sourceName: 'garden.txt', text: 'A little seed. It grew.', createdAt: 1,
  chapters: [{ id: 'chapter-1', title: 'Chapter One', paragraphs: [{ id: 'p1', text: 'A little seed. It grew.' }] }],
} }));

vi.mock('../core/document', async importOriginal => {
  const actual = await importOriginal<typeof import('../core/document')>();
  return { ...actual, extractFile: vi.fn().mockResolvedValue(loadedStory) };
});

afterEach(() => { cleanup(); vi.unstubAllGlobals(); localStorage.clear(); });

describe('reader import interactions', () => {
  it('shows a readable error for a non-JSON sharing-link response', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('<html>proxy error</html>', { status: 502, headers: { 'Content-Type': 'text/html' } })));
    render(<App />);
    fireEvent.change(screen.getByLabelText('A link to your story'), { target: { value: 'https://onedrive.live.com/?id=sample' } });
    fireEvent.submit(screen.getByLabelText('A link to your story').closest('form')!);
    expect(await screen.findByText(/reader API could not complete/i)).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Check status' })).toBeTruthy();
  });

  it('opens a file dropped onto the landing page', async () => {
    render(<App />);
    const landing = screen.getByRole('main');
    fireEvent.dragOver(landing, { dataTransfer: { types: ['Files'] } });
    fireEvent.drop(landing, { dataTransfer: { files: [new File(['A little seed. It grew.'], 'garden.txt', { type: 'text/plain' })] } });
    expect(await screen.findByRole('heading', { name: 'The Paper Garden' })).toBeTruthy();
  });

  it('restores bookmarks after reopening the same file', async () => {
    vi.spyOn(window, 'prompt').mockReturnValue('Morning pause');
    const reopen = () => {
      const landing = screen.getByRole('main');
      fireEvent.drop(landing, { dataTransfer: { files: [new File(['A little seed. It grew.'], 'garden.txt', { type: 'text/plain' })] } });
    };
    const { unmount } = render(<App />);
    reopen();
    await screen.findByRole('heading', { name: 'The Paper Garden' });
    fireEvent.click(screen.getByRole('button', { name: 'Bookmark' }));
    expect(await screen.findByText('Morning pause')).toBeTruthy();
    unmount();
    render(<App />);
    reopen();
    expect(await screen.findByText('Morning pause')).toBeTruthy();
  });

  it('renames and deletes a bookmark without storing story text in its record', async () => {
    vi.spyOn(window, 'prompt').mockReturnValueOnce('Morning pause').mockReturnValueOnce('Quiet moment');
    const { unmount } = render(<App />);
    fireEvent.drop(screen.getByRole('main'), { dataTransfer: { files: [new File(['A little seed. It grew.'], 'garden.txt', { type: 'text/plain' })] } });
    await screen.findByRole('heading', { name: 'The Paper Garden' });
    fireEvent.click(screen.getByRole('button', { name: 'Bookmark' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Rename Morning pause' }));
    expect(await screen.findByRole('button', { name: 'Jump to Quiet moment' })).toBeTruthy();
    const bookmarkKey = Object.keys(localStorage).find(key => key.startsWith('psr-bookmarks-fnv1a64-'));
    expect(bookmarkKey).toBeTruthy();
    expect(localStorage.getItem(bookmarkKey!)).not.toContain('A little seed. It grew.');
    fireEvent.click(screen.getByRole('button', { name: 'Delete Quiet moment' }));
    expect(screen.queryByRole('button', { name: 'Jump to Quiet moment' })).toBeNull();
    unmount();
  });

  it('groups paragraph and chapter skips under a labeled options menu', async () => {
    render(<App />);
    fireEvent.drop(screen.getByRole('main'), { dataTransfer: { files: [new File(['A little seed. It grew.'], 'garden.txt', { type: 'text/plain' })] } });
    await screen.findByRole('heading', { name: 'The Paper Garden' });
    fireEvent.click(screen.getByRole('button', { name: 'More skip options' }));
    expect(screen.getByRole('group', { name: 'Paragraph and chapter navigation' })).toBeTruthy();
    expect(screen.getByText(/Paragraph: Ctrl/)).toBeTruthy();
  });

  it('opens the in-app privacy policy from the footer', () => {
    render(<App />);
    fireEvent.click(screen.getByRole('button', { name: 'Privacy' }));
    expect(screen.getByRole('dialog', { name: 'Privacy policy' })).toBeTruthy();
    expect(within(screen.getByRole('dialog', { name: 'Privacy policy' })).getByText(/Your story is processed for reading and isn't publicly shared\./)).toBeTruthy();
  });

  it('shows local storage items and reports what Clear everything removed', async () => {
    localStorage.setItem('psr-volume-preferences', '{"volume":0.5}');
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(Response.json({ ok: true })));
    render(<App />);
    fireEvent.click(screen.getByRole('button', { name: 'Reader settings' }));
    fireEvent.click(screen.getByRole('button', { name: 'Review saved data' }));
    expect(screen.getByRole('dialog', { name: 'Stored reader data' })).toBeTruthy();
    expect(screen.getByText('Volume preference')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Clear everything' }));
    expect(await screen.findByText(/local preferences and locators cleared/)).toBeTruthy();
    expect(Object.keys(localStorage).filter(key => key.startsWith('psr-'))).toHaveLength(0);
  });

  it('imports a matching bookmark export and rejects a mismatched document', async () => {
    render(<App />);
    fireEvent.drop(screen.getByRole('main'), { dataTransfer: { files: [new File(['A little seed. It grew.'], 'garden.txt', { type: 'text/plain' })] } });
    await screen.findByRole('heading', { name: 'The Paper Garden' });
    const base = { id: 'imported', chapterId: 'chapter-1', paragraphId: 'p1', sentenceIndex: 1, audioTimeEstimate: 5, userLabel: 'Imported pause', createdAt: 1 };
    const importInput = document.querySelector<HTMLInputElement>('input[accept="application/json,.json"]')!;
    const matching = { format: 'private-story-reader-bookmarks', version: 1, documentFingerprint: documentFingerprint(loadedStory), bookmarks: [{ ...base, documentFingerprint: documentFingerprint(loadedStory) }] };
    const matchingFile = new File([JSON.stringify(matching)], 'marks.json', { type: 'application/json' });
    Object.defineProperty(matchingFile, 'text', { value: async () => JSON.stringify(matching) });
    fireEvent.change(importInput, { target: { files: [matchingFile] } });
    expect(await screen.findByRole('button', { name: 'Jump to Imported pause' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Delete Imported pause' }));
    const mismatched = { ...matching, documentFingerprint: 'another-document', bookmarks: [{ ...base, documentFingerprint: 'another-document' }] };
    const mismatchedFile = new File([JSON.stringify(mismatched)], 'marks.json', { type: 'application/json' });
    Object.defineProperty(mismatchedFile, 'text', { value: async () => JSON.stringify(mismatched) });
    fireEvent.change(importInput, { target: { files: [mismatchedFile] } });
    expect(await screen.findByText(/belong to a different story/i)).toBeTruthy();
  });

  it('asks before resuming a saved location and continues from that paragraph', async () => {
    const resumedStory = structuredClone(loadedStory);
    resumedStory.chapters[0].paragraphs.push({ id: 'p2', text: 'A second paragraph.' });
    resumedStory.text += '\n\nA second paragraph.';
    vi.mocked(extractFile).mockResolvedValueOnce(resumedStory);
    localStorage.setItem(`psr-position-${resumedStory.sourceName}-${resumedStory.text.length}`, JSON.stringify({ chapterIndex: 0, paragraphIndex: 1 }));
    render(<App />);
    fireEvent.drop(screen.getByRole('main'), { dataTransfer: { files: [new File(['file'], 'garden.txt')] } });
    expect(await screen.findByRole('dialog', { name: 'Continue where you left off?' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
    expect(screen.getByRole('slider', { name: 'Jump to a paragraph' }).getAttribute('value')).toBe('1');
  });
});
