import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';
import { fileURLToPath } from 'node:url';

test('home loads, scans accessibly, and opens a local chaptered text file without external requests', async ({
  page,
}) => {
  await page.route('**/*', async (route) => {
    const requestUrl = new URL(route.request().url());
    if (requestUrl.origin !== 'http://127.0.0.1:4173') {
      await route.abort();
      return;
    }
    await route.continue();
  });

  const response = await page.goto('/');
  expect(response?.headers()['cross-origin-opener-policy']).toBe('same-origin');
  expect(response?.headers()['cross-origin-embedder-policy']).toBe('credentialless');
  expect(await page.evaluate(() => crossOriginIsolated)).toBe(true);
  await expect(page).toHaveTitle('Private Story Reader');

  const homeAccessibility = await new AxeBuilder({ page }).analyze();
  expect(homeAccessibility.violations).toEqual([]);

  await page
    .locator('input[type="file"]')
    .first()
    .setInputFiles(fileURLToPath(new URL('../fixtures/chaptered.txt', import.meta.url)));

  await expect(page.getByRole('navigation', { name: 'Story chapters' })).toContainText('Chapter One');
  await expect(page.getByRole('navigation', { name: 'Story chapters' })).toContainText('Chapter Two');
  await expect(page.getByText('A small garden grew beside the old stone wall.')).toBeVisible();
});

test('audiobook dialog explains that browser speech is not downloadable', async ({ page }) => {
  await page.route('**/*', async (route) => {
    const requestUrl = new URL(route.request().url());
    if (requestUrl.origin !== 'http://127.0.0.1:4173') {
      await route.abort();
      return;
    }
    await route.continue();
  });

  await page.goto('/');
  await page
    .locator('input[type="file"]')
    .first()
    .setInputFiles(fileURLToPath(new URL('../fixtures/chaptered.txt', import.meta.url)));
  await page.getByRole('button', { name: 'Download audiobook' }).first().click();

  const dialog = page.getByRole('dialog', { name: 'Create audiobook' });
  await expect(dialog).toBeVisible();
  await expect(
    dialog.getByText('Browser and operating-system voices cannot provide audio samples for file export.'),
  ).toBeVisible();
  await expect(dialog.getByRole('option', { name: 'Browser voice · not downloadable' })).toHaveAttribute(
    'disabled',
    '',
  );
  await expect(dialog.getByRole('option', { name: /Fast · LibriTTS-R · Medium · 79 MB/u })).toBeAttached();
  await expect(dialog.getByRole('option', { name: /High quality · LibriTTS · p3922 · 137 MB/u })).toBeAttached();
  await expect(dialog.getByRole('button', { name: 'Start export' })).toBeDisabled();

  await dialog.getByRole('button', { name: 'Switch to a downloadable voice' }).click();
  await expect(dialog.getByText('DOWNLOADABLE', { exact: true })).toBeVisible();
  await expect(dialog.getByRole('button', { name: 'Start export' })).toBeDisabled();
  await dialog.getByRole('checkbox', { name: /I have the right to convert this document/u }).check();
  await expect(dialog.getByRole('button', { name: 'Start export' })).toBeEnabled();
  await expect((await new AxeBuilder({ page }).include('.audiobook-dialog').analyze()).violations).toEqual(
    [],
  );
});
