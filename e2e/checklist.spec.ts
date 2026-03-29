import { test, expect } from '@playwright/test';

test.describe('Checklist', () => {
  test.describe.serial('Checklist interactions', () => {
    test('view checklist for a renewal', async ({ page }) => {
      // Navigate to renewals list
      await page.goto('/renewals');

      // Wait for renewals to load
      await expect(page.getByRole('heading', { name: 'Renewals' })).toBeVisible();

      // Wait for at least one renewal row to appear
      const renewalRow = page.locator('tr[style], tbody tr').filter({ hasText: /Motor|Home|Commercial/ }).first();
      await expect(renewalRow).toBeVisible({ timeout: 15_000 });

      // Click the first renewal row
      await renewalRow.click();

      // Wait for checklist page to load
      await page.waitForURL(/\/renewals\/[a-f0-9-]+/);

      // Verify checklist page elements
      await expect(page.getByRole('heading', { name: 'Renewal Checklist' })).toBeVisible();
      await expect(page.getByText(/\d+\/\d+ items complete/)).toBeVisible();

      // Verify checklist items are displayed
      await expect(page.getByText('Renewal notification sent')).toBeVisible();
      await expect(page.getByText('Suitability assessment completed')).toBeVisible();
      await expect(page.getByText('Market comparison documented')).toBeVisible();
      await expect(page.getByText('Premium disclosure')).toBeVisible();
      await expect(page.getByText('Commission disclosure')).toBeVisible();
    });

    test('complete a pending checklist item', async ({ page }) => {
      // Navigate to renewals list
      await page.goto('/renewals');

      // Wait for renewals to load and click first row
      const renewalRow = page.locator('tr[style], tbody tr').filter({ hasText: /Motor|Home|Commercial/ }).first();
      await expect(renewalRow).toBeVisible({ timeout: 15_000 });
      await renewalRow.click();
      await page.waitForURL(/\/renewals\/[a-f0-9-]+/);

      // Find a pending checklist item and its Complete button
      const pendingItem = page.locator('div').filter({ hasText: /^pending$/ }).first();
      const completeBtn = pendingItem.locator('..').getByRole('button', { name: 'Complete' });

      // If there's a pending item, click Complete
      if (await completeBtn.isVisible()) {
        await completeBtn.click();

        // Wait for the item to update - status should no longer be "pending"
        await expect(
          pendingItem.locator('..').getByText('pending')
        ).not.toBeVisible({ timeout: 10_000 });
      }
    });
  });

  test('back to renewals link works', async ({ page }) => {
    // Navigate to renewals and click a row
    await page.goto('/renewals');
    const renewalRow = page.locator('tr[style], tbody tr').filter({ hasText: /Motor|Home|Commercial/ }).first();
    await expect(renewalRow).toBeVisible({ timeout: 15_000 });
    await renewalRow.click();
    await page.waitForURL(/\/renewals\/[a-f0-9-]+/);

    // Click back link
    await page.getByRole('link', { name: '← Back to renewals' }).click();
    await page.waitForURL('/renewals');
    await expect(page.getByRole('heading', { name: 'Renewals' })).toBeVisible();
  });

  test('document generation buttons are present', async ({ page }) => {
    // Navigate to renewals and click a row
    await page.goto('/renewals');
    const renewalRow = page.locator('tr[style], tbody tr').filter({ hasText: /Motor|Home|Commercial/ }).first();
    await expect(renewalRow).toBeVisible({ timeout: 15_000 });
    await renewalRow.click();
    await page.waitForURL(/\/renewals\/[a-f0-9-]+/);

    // Verify document generation section
    await expect(page.getByRole('heading', { name: 'Generate Documents' })).toBeVisible();
    await expect(page.getByRole('button', { name: /Renewal Notification Letter/ })).toBeVisible();
    await expect(page.getByRole('button', { name: /Suitability Assessment/ })).toBeVisible();
    await expect(page.getByRole('button', { name: /CBI Inspection Pack/ })).toBeVisible();
  });
});
