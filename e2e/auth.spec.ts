import { test, expect } from '@playwright/test';

test.describe('Authentication', () => {
  test.describe.serial('Login flow', () => {
    test('successful login redirects to dashboard', async ({ page }) => {
      await page.goto('/login');

      // Verify login page elements
      await expect(page.getByRole('heading', { name: 'BrokerComply' })).toBeVisible();
      await expect(page.getByText('Sign in to your compliance platform')).toBeVisible();

      // Fill and submit login form
      await page.getByLabel('Email').fill('michael@obrien-insurance.ie');
      await page.getByLabel('Password').fill('password123');
      await page.getByRole('button', { name: 'Sign in' }).click();

      // Verify redirect to dashboard
      await page.waitForURL('/dashboard');
      await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible();
    });

    test('invalid login shows error message', async ({ page }) => {
      await page.goto('/login');

      // Fill with wrong password
      await page.getByLabel('Email').fill('michael@obrien-insurance.ie');
      await page.getByLabel('Password').fill('wrongpassword');
      await page.getByRole('button', { name: 'Sign in' }).click();

      // Verify error message appears
      await expect(page.getByText('Invalid email or password')).toBeVisible();

      // Should still be on login page
      await expect(page.getByRole('button', { name: 'Sign in' })).toBeVisible();
    });

    test('register page loads and submits', async ({ page }) => {
      await page.goto('/register');

      // Verify register page elements
      await expect(page.getByRole('heading', { name: 'Register Your Firm' })).toBeVisible();
      await expect(page.getByText('Create a compliance platform account')).toBeVisible();

      // Fill registration form
      await page.getByLabel('Firm Name').fill('Test Brokers Ltd');
      await page.getByLabel('Your Name').fill('Test User');
      await page.getByLabel('Email').fill(`test-${Date.now()}@test-brokers.ie`);
      await page.getByLabel('Password').fill('testpassword123');

      // Submit
      await page.getByRole('button', { name: 'Register' }).click();

      // Should redirect to dashboard on success
      await page.waitForURL('/dashboard', { timeout: 10_000 });
    });
  });

  test('has link to forgot password', async ({ page }) => {
    await page.goto('/login');
    await expect(page.getByRole('link', { name: 'Forgot password?' })).toBeVisible();
  });

  test('has link to register', async ({ page }) => {
    await page.goto('/login');
    await expect(page.getByRole('link', { name: 'Register your firm' })).toBeVisible();
  });
});
