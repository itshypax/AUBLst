import { expect, test } from '@playwright/test';

test('zeigt den Sitzungseinstieg ohne Zugangsdaten', async ({ page }) => {
  await page.goto('/');
  await expect(page).toHaveTitle(/Leitstelle Auenburg/);
  await expect(page.getByRole('dialog', { name: 'Mit der Leitstelle verbinden' })).toBeVisible();
  await expect(page.getByRole('textbox', { name: 'Sitzungscode' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Verbinden' })).toBeVisible();
});

test('bleibt auf einem schmalen Bildschirm ohne horizontales Scrollen bedienbar', async ({ page }) => {
  await page.goto('/');
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow).toBeLessThanOrEqual(1);
  await expect(page.getByRole('button', { name: 'Verbinden' })).toBeInViewport();
});
