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

  await page.goto('/');
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
