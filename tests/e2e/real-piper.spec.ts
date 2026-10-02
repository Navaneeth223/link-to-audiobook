import JSZip from 'jszip';
import { expect, test } from '@playwright/test';
import { readFile } from 'node:fs/promises';

test('real Piper synthesizes and decodes an MP3 containing typographic input', async ({ page }, testInfo) => {
  test.skip(process.env.RUN_REAL_PIPER !== '1', 'Set RUN_REAL_PIPER=1 to download and run the local voice.');
  test.skip(testInfo.project.name !== 'desktop-1440x900', 'Run the live Piper smoke test once at desktop size.');
  test.setTimeout(10 * 60 * 1_000);

  const consoleErrors: string[] = [];
  page.on('console', (message) => {
    if (message.type() === 'error') consoleErrors.push(message.text());
  });
  await page.addInitScript(() => {
    Object.defineProperty(window, 'showSaveFilePicker', { configurable: true, value: undefined });
  });
  const startedAt = Date.now();
  const source =
    'Chapter One\nA ﬁle—“quoted text” — is ready. A soft\u00adhyphen and replacement\uFFFD mark.';
  await page.goto('/');
  await page.locator('input[type="file"]').first().setInputFiles({
    name: 'piper-regression.txt',
    mimeType: 'text/plain',
    buffer: Buffer.from(source, 'utf8'),
  });
  await expect(page.getByText(source.split('\n')[1], { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Download audiobook' }).first().click();
  const dialog = page.getByRole('dialog', { name: 'Create audiobook' });
  await dialog.getByLabel('Voice').selectOption('en_US-libritts-high');
  await dialog.getByRole('checkbox', { name: /I have the right to convert this document/u }).check();
  await dialog.getByRole('button', { name: 'Start export' }).click();

  const finished = page.getByRole('dialog', { name: 'Audiobook complete' });
  await expect(finished).toBeVisible({ timeout: 9 * 60 * 1_000 });
  const resultText = await finished.innerText();
  const downloadPromise = page.waitForEvent('download');
  await finished.getByRole('link', { name: 'Download audiobook' }).click();
  const download = await downloadPromise;
  const path = await download.path();
  if (!path) throw new Error('The real Piper export did not produce a downloadable file.');
  const archive = await JSZip.loadAsync(await readFile(path));
  const audioEntry = Object.values(archive.files).find((entry) => !entry.dir && entry.name.endsWith('.mp3'));
  if (!audioEntry) throw new Error('The real Piper ZIP did not contain an MP3 chapter.');
  const encodedAudio = Buffer.from(await audioEntry.async('arraybuffer')).toString('base64');
  const decoded = await page.evaluate(async (base64) => {
    const context = new AudioContext();
    try {
      const bytes = Uint8Array.from(atob(base64), (character) => character.charCodeAt(0));
      const audioBuffer = bytes.buffer;
      const audio = await context.decodeAudioData(audioBuffer);
      return { duration: audio.duration, samples: audio.length };
    } finally {
      await context.close();
    }
  }, encodedAudio);
  expect(decoded.duration).toBeGreaterThan(0);
  expect(decoded.samples).toBeGreaterThan(0);
  expect(consoleErrors.filter((message) => /Gather.*out of data bounds/iu.test(message))).toEqual([]);
  const warning = finished.locator('.audiobook-error[role="status"]');
  console.log(
    'LIVE_PIPER_MEASUREMENT',
    JSON.stringify({
      totalElapsedSeconds: (Date.now() - startedAt) / 1_000,
      decodedAudioSeconds: decoded.duration,
      endToEndRealtimeFactor: decoded.duration / ((Date.now() - startedAt) / 1_000),
      skippedSentenceWarnings: (await warning.count()) ? await warning.innerText() : '',
    }),
  );
  await testInfo.attach('real-piper-audio-check.json', {
    body: JSON.stringify({
      durationSeconds: decoded.duration,
      samples: decoded.samples,
      elapsedSeconds: (Date.now() - startedAt) / 1_000,
      resultText,
    }),
    contentType: 'application/json',
  });
});
