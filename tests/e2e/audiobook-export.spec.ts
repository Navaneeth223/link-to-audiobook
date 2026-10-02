import { expect, test } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const blockExternalRequests = async (page: import('@playwright/test').Page) => {
  const externalRequests: string[] = [];
  await page.route('**/*', async (route) => {
    if (new URL(route.request().url()).origin !== 'http://127.0.0.1:4173') {
      externalRequests.push(route.request().url());
      await route.abort();
      return;
    }
    await route.continue();
  });
  await page.route('http://127.0.0.1:4173/api/auth/logout', async (route) => {
    await route.fulfill({ contentType: 'application/json', body: JSON.stringify({ ok: true }) });
  });
  return externalRequests;
};

const mockExportWorker = async (
  page: import('@playwright/test').Page,
  mode: 'controls' | 'complete' | 'interrupt-once',
) => {
  await page.addInitScript(
    ({ mode }) => {
      Object.defineProperty(window, 'showSaveFilePicker', { configurable: true, value: undefined });
      const NativeWorker = window.Worker;
      type MockStartMessage = {
        type: 'start';
        story: {
          title: string;
          text: string;
          chapters: Array<{ id: string; title: string; paragraphs: Array<{ text: string }> }>;
        };
        settings: {
          format: string;
          bitrate: number;
          speed: number;
          volume: number;
          pauseBetweenParagraphsMs: number;
          pauseBetweenChaptersMs: number;
          chapters: number[];
        };
        metadata: { title: string; author: string; voice: string };
      };
      type MockWorkerMessage = MockStartMessage | { type: 'pause' | 'resume' | 'cancel' };
      const fingerprint = (text: string) => {
        let hash = 0xcbf29ce484222325n;
        for (const character of text) {
          hash ^= BigInt(character.codePointAt(0) ?? 0);
          hash = BigInt.asUintN(64, hash * 0x100000001b3n);
        }
        return `fnv1a64-${hash.toString(16).padStart(16, '0')}`;
      };
      const getManifestData = async (message: MockStartMessage) => {
        const documentId = fingerprint(message.story.text);
        const metadata = {
          title: message.metadata.title.trim() || message.story.title,
          author: message.metadata.author.trim() || 'Unknown author',
          voice: message.metadata.voice,
        };
        const chapters = message.settings.chapters.map((index) => {
          const chapter = message.story.chapters[index];
          const chunkCount = chapter.paragraphs.reduce(
            (count, paragraph) => count + (paragraph.text.trim() ? 1 : 0),
            0,
          );
          return { id: chapter.id, title: chapter.title, chunkCount };
        });
        const jobHash = await crypto.subtle.digest(
          'SHA-256',
          new TextEncoder().encode(
            JSON.stringify({
              fingerprint: documentId,
              voiceId: 'en_US-libritts-high',
              settings: message.settings,
              metadata,
              chapters,
            }),
          ),
        );
        const jobId = Array.from(new Uint8Array(jobHash), (byte) => byte.toString(16).padStart(2, '0')).join(
          '',
        );
        return { documentId, metadata, chapters, jobId };
      };
      let exportWorkerCount = Number(sessionStorage.getItem('psr-test-export-worker-count') ?? '0');
      class MockExportWorker {
        onmessage: ((event: MessageEvent) => void) | null = null;
        onerror: ((event: ErrorEvent) => void) | null = null;
        paused = false;
        timer: number | undefined;
        startMessage: MockStartMessage | undefined;

        constructor(private readonly completes: boolean) {}

        postMessage(message: MockWorkerMessage) {
          if (message.type === 'start') {
            this.startMessage = message;
            this.onmessage?.({
              data: {
                type: 'progress',
                state: 'generating',
                percent: 20,
                completedChunks: 1,
                totalChunks: 5,
                chapterIndex: 0,
                chunkIndex: 1,
                elapsedMs: 500,
                etaSeconds: 2,
                chapters: [{ title: 'Chapter One', status: 'generating' }],
              },
            } as MessageEvent);
            if (mode === 'complete' || this.completes) {
              void this.finish();
            } else if (mode === 'interrupt-once') {
              void this.interrupt();
            } else {
              this.timer = window.setTimeout(() => {
                if (!this.paused) this.sendProgress();
              }, 500);
            }
          } else if (message.type === 'pause') {
            this.paused = true;
            this.sendProgress('paused');
          } else if (message.type === 'resume') {
            this.paused = false;
            this.sendProgress('generating');
          } else if (message.type === 'cancel') {
            window.clearTimeout(this.timer);
            this.onmessage?.({ data: { type: 'cancelled' } } as MessageEvent);
          }
        }

        sendProgress(state = 'generating') {
          this.onmessage?.({
            data: {
              type: 'progress',
              state,
              percent: 20,
              completedChunks: 1,
              totalChunks: 5,
              chapterIndex: 0,
              chunkIndex: 1,
              elapsedMs: 500,
              etaSeconds: 2,
              chapters: [{ title: 'Chapter One', status: 'generating' }],
            },
          } as MessageEvent);
        }

        async finish() {
          const message = this.startMessage;
          if (!message) throw new Error('The test worker did not receive export settings.');
          const { documentId, metadata, chapters, jobId } = await getManifestData(message);
          const root = await navigator.storage.getDirectory();
          const exportsDirectory = await root.getDirectoryHandle('psr-audiobook-exports', {
            create: true,
          });
          const jobDirectory = await exportsDirectory.getDirectoryHandle(`job-${jobId}`, {
            create: true,
          });
          for (const [name, contents] of [
            ['mock-export.zip', 'mock complete zip'],
            ['chapter-0001.mp3', 'mock preview audio'],
          ]) {
            const file = await jobDirectory.getFileHandle(name, { create: true });
            const writable = await file.createWritable();
            await writable.write(contents);
            await writable.close();
          }
          const manifestFile = await jobDirectory.getFileHandle('manifest.json', { create: true });
          const manifestWriter = await manifestFile.createWritable();
          await manifestWriter.write(
            JSON.stringify({
              version: 1,
              jobId,
              documentFingerprint: documentId,
              voiceId: 'en_US-libritts-high',
              settings: message.settings,
              metadata,
              chapters: chapters.map((chapter, index) => ({
                ...chapter,
                chunkKeys: Array.from({ length: chapter.chunkCount }, () => 'a'.repeat(64)),
                chunkEndsParagraph: Array.from({ length: chapter.chunkCount }, () => true),
                fileName: `chapter-${String(index + 1).padStart(4, '0')}.mp3`,
                durationSeconds: 2,
              })),
              state: 'complete',
              updatedAt: Date.now(),
            }),
          );
          await manifestWriter.close();
          this.onmessage?.({
            data: {
              type: 'done',
              jobId,
              fileName: 'mock-export.zip',
              previewFileName: 'chapter-0001.mp3',
              durationSeconds: 2,
              sizeBytes: 17,
              savedDirectly: false,
              skippedSentenceCount: 0,
              skippedSentenceWarnings: [],
            },
          } as MessageEvent);
        }

        async interrupt() {
          const message = this.startMessage;
          if (!message) throw new Error('The test worker did not receive export settings.');
          const { documentId, metadata, chapters, jobId } = await getManifestData(message);
          const root = await navigator.storage.getDirectory();
          const exportsDirectory = await root.getDirectoryHandle('psr-audiobook-exports', {
            create: true,
          });
          const jobDirectory = await exportsDirectory.getDirectoryHandle(`job-${jobId}`, {
            create: true,
          });
          const manifestFile = await jobDirectory.getFileHandle('manifest.json', { create: true });
          const writer = await manifestFile.createWritable();
          await writer.write(
            JSON.stringify({
              version: 1,
              jobId,
              documentFingerprint: documentId,
              voiceId: 'en_US-libritts-high',
              settings: message.settings,
              metadata,
              chapters: chapters.map((chapter) => ({
                ...chapter,
                chunkKeys: Array.from({ length: chapter.chunkCount }, () => ''),
                chunkEndsParagraph: Array.from({ length: chapter.chunkCount }, () => true),
              })),
              state: 'interrupted',
              updatedAt: Date.now(),
            }),
          );
          await writer.close();
          this.onmessage?.({
            data: { type: 'error', message: 'The mocked export was interrupted.' },
          } as MessageEvent);
        }

        terminate() {
          window.clearTimeout(this.timer);
        }
      }

      window.Worker = class {
        constructor(url: string | URL, options?: WorkerOptions) {
          if (String(url).includes('audiobookExport.worker')) {
            exportWorkerCount++;
            sessionStorage.setItem('psr-test-export-worker-count', String(exportWorkerCount));
            return new MockExportWorker(mode === 'interrupt-once' && exportWorkerCount > 1);
          }
          return new NativeWorker(url, options);
        }
      } as typeof Worker;
    },
    { mode },
  );
};

const openExportDialog = async (page: import('@playwright/test').Page) => {
  await page.goto('/');
  await page
    .locator('input[type="file"]')
    .first()
    .setInputFiles(fileURLToPath(new URL('../fixtures/chaptered.txt', import.meta.url)));
  await page.getByRole('button', { name: 'Download audiobook' }).first().click();
  const dialog = page.getByRole('dialog', { name: 'Create audiobook' });
  await expect(dialog).toBeVisible();
  await dialog.getByLabel('Voice').selectOption('en_US-libritts-high');
  await dialog.getByRole('checkbox', { name: /I have the right to convert this document/u }).check();
  return dialog;
};

test('mocked export can pause, resume, and cancel without model or story network requests', async ({
  page,
}, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop-1440x900', 'Exercise worker controls at desktop size.');
  const externalRequests = await blockExternalRequests(page);
  await mockExportWorker(page, 'controls');
  const dialog = await openExportDialog(page);
  await dialog.getByRole('button', { name: 'Start export' }).click();

  const progress = page.getByRole('dialog', { name: 'Creating your audiobook' });
  await expect(progress.getByRole('progressbar', { name: 'Audiobook export progress' })).toBeVisible();
  await progress.getByRole('button', { name: 'Pause' }).click();
  await expect(progress.getByText('Export paused')).toBeVisible();
  await progress.getByRole('button', { name: 'Resume' }).click();
  await expect(progress.getByText(/Generating audio/u)).toBeVisible();
  await progress.getByRole('button', { name: 'Cancel export' }).click();
  await expect(page.getByRole('dialog', { name: 'Create audiobook' })).toBeVisible();
  await expect(page.getByRole('alert')).toContainText('Export cancelled.');
  expect(externalRequests).toEqual([]);
});

test('restores an interrupted export after reloading and reopening the same local story', async ({
  page,
}, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop-1440x900', 'Exercise reload recovery at desktop size.');
  const externalRequests = await blockExternalRequests(page);
  await mockExportWorker(page, 'interrupt-once');
  let dialog = await openExportDialog(page);
  await dialog.getByRole('button', { name: 'Start export' }).click();
  await expect(page.getByRole('alert')).toContainText('mocked export was interrupted');

  await page.reload();
  await page
    .locator('input[type="file"]')
    .first()
    .setInputFiles(fileURLToPath(new URL('../fixtures/chaptered.txt', import.meta.url)));
  await page.getByRole('button', { name: 'Download audiobook' }).first().click();
  dialog = page.getByRole('dialog', { name: 'Create audiobook' });
  await expect(dialog.getByText(/An unfinished export/u)).toBeVisible();
  await dialog.getByRole('button', { name: 'Restore settings to resume' }).click();
  await expect(dialog.getByRole('status')).toContainText('Review the restored settings');
  await dialog.getByRole('checkbox', { name: /I have the right to convert this document/u }).check();
  await dialog.getByRole('button', { name: 'Start export' }).click();

  await expect(page.getByRole('dialog', { name: 'Audiobook complete' })).toBeVisible();
  expect(externalRequests).toEqual([]);
});

test('mocked ZIP export downloads the assembled archive, not its preview chapter', async ({
  page,
}, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop-1440x900', 'Exercise file download at desktop size.');
  const externalRequests = await blockExternalRequests(page);
  await mockExportWorker(page, 'complete');
  const dialog = await openExportDialog(page);
  await dialog.getByRole('button', { name: 'Start export' }).click();

  const finished = page.getByRole('dialog', { name: 'Audiobook complete' });
  await expect(finished).toBeVisible();
  const downloadPromise = page.waitForEvent('download');
  await finished.getByRole('link', { name: 'Download audiobook' }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toBe('mock-export.zip');
  const path = await download.path();
  if (!path) throw new Error('The browser did not create a download file.');
  expect(await readFile(path, 'utf8')).toBe('mock complete zip');
  expect(externalRequests).toEqual([]);

  await finished.getByRole('button', { name: 'Done' }).click();
  await page.getByRole('button', { name: 'Reader settings' }).click();
  await page.getByRole('button', { name: 'Review saved data' }).click();
  const storedData = page.getByRole('dialog', { name: 'Stored reader data' });
  await expect(storedData).not.toContainText('Audiobook export · complete');
  await storedData.getByRole('button', { name: 'Clear everything' }).click();
  await expect(storedData.getByRole('status')).toContainText('Clear request finished');
  const exportsDirectoryExists = await page.evaluate(async () => {
    try {
      await (await navigator.storage.getDirectory()).getDirectoryHandle('psr-audiobook-exports');
      return true;
    } catch (error) {
      return !(error instanceof DOMException && error.name === 'NotFoundError');
    }
  });
  expect(exportsDirectoryExists).toBe(false);
});
