import { test as setup, expect } from '@playwright/test';
import { existsSync, mkdirSync } from 'fs';

const authFile = 'e2e/.auth/user.json';

setup('authenticate', async ({ page }) => {
  // Navigate to login page
  await page.goto('/login');

  // Fill login form
  await page.getByLabel('Email').fill('michael@obrien-insurance.ie');
  await page.getByLabel('Password').fill('password123');

  // Submit
  await page.getByRole('button', { name: 'Sign in' }).click();

  // Wait for redirect to dashboard
  await page.waitForURL('/dashboard');

  // Save signed-in state
  existsSync('e2e/.auth') || mkdirSync('e2e/.auth', { recursive: true });
  await page.context().storageState({ path: authFile });
});
