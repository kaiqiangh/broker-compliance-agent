import { test, expect } from '@playwright/test';

test.describe('Dashboard', () => {
  test('dashboard loads with stats and renewal count', async ({ page }) => {
    await page.goto('/dashboard');

    // Wait for dashboard to finish loading
    await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible();
    await expect(page.getByText('CPC Renewal Compliance Overview')).toBeVisible();

    // Verify stats cards are rendered
    await expect(page.getByText('Total Renewals')).toBeVisible();
    await expect(page.getByText('Compliance Rate')).toBeVisible();
    await expect(page.getByText('At Risk')).toBeVisible();
    await expect(page.getByText('Overdue')).toBeVisible();

    // Verify renewal count is a number (not loading)
    const totalCard = page.locator('p:text("Total Renewals")').locator('..');
    await expect(totalCard.getByText(/^\d+$/)).toBeVisible();
  });

  test('status chart is visible', async ({ page }) => {
    await page.goto('/dashboard');

    // Wait for loading to complete
    await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible();

    // Verify Status Distribution section exists
    await expect(page.getByRole('heading', { name: 'Status Distribution' })).toBeVisible();

    // Verify donut chart inner text shows total
    await expect(page.getByText('Total').first()).toBeVisible();

    // Verify legend items
    await expect(page.getByText('Pending')).toBeVisible();
    await expect(page.getByText('In Progress')).toBeVisible();
    await expect(page.getByText('Compliant')).toBeVisible();

    // Verify stacked bar exists (the colored bar chart)
    await expect(page.getByTitle(/Pending|In Progress|Compliant|At Risk|Overdue/).first()).toBeVisible();
  });

  test('upcoming deadlines section is present', async ({ page }) => {
    await page.goto('/dashboard');

    await expect(page.getByRole('heading', { name: 'Upcoming Deadlines' })).toBeVisible();
  });

  test('quick action links work', async ({ page }) => {
    await page.goto('/dashboard');

    // Verify quick action links
    await expect(page.getByRole('link', { name: 'Import CSV' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'View All Renewals' })).toBeVisible();
  });

  test('recent activity section is present', async ({ page }) => {
    await page.goto('/dashboard');

    await expect(page.getByRole('heading', { name: 'Recent Activity' })).toBeVisible();
  });
});
