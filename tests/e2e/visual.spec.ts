import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';
import { fileURLToPath } from 'node:url';

test('@visual home page renders a non-empty screenshot', async ({ page }) => {
  await page.goto('/');
  const screenshot = await page.screenshot({ animations: 'disabled' });

  expect(screenshot.subarray(0, 8)).toEqual(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
  expect(screenshot.byteLength).toBeGreaterThan(1_000);
  expect(screenshot.readUInt32BE(16)).toBeGreaterThan(0);
  expect(screenshot.readUInt32BE(20)).toBeGreaterThan(0);
});

test('@visual audiobook dialog renders in all reading themes', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop-1440x900', 'Capture all theme snapshots at desktop size.');
  await page.goto('/');
  await page
    .locator('input[type="file"]')
    .first()
    .setInputFiles(fileURLToPath(new URL('../fixtures/chaptered.txt', import.meta.url)));

  for (const theme of ['Light', 'Sepia', 'Dark', 'High contrast']) {
    await page.getByRole('button', { name: 'Reader settings' }).click();
    const settings = page.getByRole('dialog', { name: 'Reading settings' });
    await settings.getByRole('button', { name: theme }).click();
    await settings.getByRole('button', { name: 'Done' }).click();
    await page.getByRole('button', { name: 'Download audiobook' }).first().click();
    const dialog = page.getByRole('dialog', { name: 'Create audiobook' });
    await expect(dialog).toBeVisible();

    const screenshot = await dialog.screenshot({ animations: 'disabled' });
    expect(screenshot.subarray(0, 8)).toEqual(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
    expect((await new AxeBuilder({ page }).include('.audiobook-dialog').analyze()).violations).toEqual([]);
    await testInfo.attach(`audiobook-dialog-${theme.toLowerCase().replace(/\s+/gu, '-')}`, {
      body: screenshot,
      contentType: 'image/png',
    });
    await dialog.getByRole('button', { name: 'Close audiobook export' }).click();
  }
});
