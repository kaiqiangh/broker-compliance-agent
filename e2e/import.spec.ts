import { test, expect } from '@playwright/test';
import path from 'path';

test.describe('Import', () => {
  test.describe.serial('CSV import flow', () => {
    test('upload CSV shows preview', async ({ page }) => {
      await page.goto('/import');

      // Verify import page loads
      await expect(page.getByRole('heading', { name: 'Import Data' })).toBeVisible();
      await expect(page.getByText('Upload your BMS export (CSV) to import policy data')).toBeVisible();

      // Verify upload area
      await expect(page.getByText('Drop your CSV file here')).toBeVisible();

      // Upload the test CSV file
      const fileInput = page.locator('input[type="file"]');
      await fileInput.setInputFiles(
        path.join(__dirname, '..', 'test-data', 'applied-epic-export.csv')
      );

      // Wait for file to be analyzed and mapping step to appear
      await expect(page.getByText('Format detected')).toBeVisible({ timeout: 15_000 });

      // Verify preview table shows CSV data
      await expect(page.getByText('Preview (first')).toBeVisible();

      // Verify some CSV headers are in the preview table
      await expect(page.getByText('ClientName')).toBeVisible();
      await expect(page.getByText('PolicyType')).toBeVisible();
    });

    test('import policies completes successfully', async ({ page }) => {
      await page.goto('/import');

      // Upload CSV file
      const fileInput = page.locator('input[type="file"]');
      await fileInput.setInputFiles(
        path.join(__dirname, '..', 'test-data', 'applied-epic-export.csv')
      );

      // Wait for mapping step
      await expect(page.getByText('Format detected')).toBeVisible({ timeout: 15_000 });

      // Proceed to validation step
      await page.getByRole('button', { name: 'Validate →' }).click();

      // Verify validation/confirm step
      await expect(page.getByRole('heading', { name: 'Confirm Import' })).toBeVisible();
      await expect(page.getByText('Will import')).toBeVisible();

      // Click import button
      const importBtn = page.getByRole('button', { name: /Import \d+ policies/ });
      await importBtn.click();

      // Wait for completion
      await expect(page.getByRole('heading', { name: 'Import Complete' })).toBeVisible({ timeout: 30_000 });

      // Verify success message
      await expect(page.getByText(/policies imported from/)).toBeVisible();
      await expect(page.getByText('Imported')).toBeVisible();

      // Verify navigation options
      await expect(page.getByRole('link', { name: 'Go to Dashboard' })).toBeVisible();
      await expect(page.getByRole('button', { name: 'Import More' })).toBeVisible();
    });
  });

  test('navigation shows upload steps', async ({ page }) => {
    await page.goto('/import');

    // Verify progress steps are visible
    await expect(page.getByText('Upload', { exact: true })).toBeVisible();
    await expect(page.getByText('Map Fields')).toBeVisible();
    await expect(page.getByText('Validate')).toBeVisible();
    await expect(page.getByText('Complete')).toBeVisible();
  });

  test('supported formats are listed', async ({ page }) => {
    await page.goto('/import');

    await expect(page.getByText('Supported: Applied Epic, Acturis, Generic CSV')).toBeVisible();
  });
});
