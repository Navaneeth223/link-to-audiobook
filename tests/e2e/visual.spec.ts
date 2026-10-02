import { expect, test } from '@playwright/test';

test('@visual home page renders a non-empty screenshot', async ({ page }) => {
  await page.goto('/');
  const screenshot = await page.screenshot({ animations: 'disabled' });

  expect(screenshot.subarray(0, 8)).toEqual(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
  expect(screenshot.byteLength).toBeGreaterThan(1_000);
  expect(screenshot.readUInt32BE(16)).toBeGreaterThan(0);
  expect(screenshot.readUInt32BE(20)).toBeGreaterThan(0);
});
