import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import App from './App';

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
    expect(await screen.findByText(/document service is unavailable/i)).toBeTruthy();
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
});
