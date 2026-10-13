import { test, expect } from '@playwright/test';

// 端到端冒烟：登录页、健康检查、未登录保护。
test('login page renders', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('#loginForm')).toBeVisible();
  await expect(page.locator('#username')).toBeVisible();
  await expect(page.locator('#password')).toBeVisible();
});

test('health endpoint is reachable', async ({ request }) => {
  const response = await request.get('/health');
  expect(response.ok()).toBeTruthy();
  expect((await response.json()).status).toBe('ok');
});

test('protected endpoint rejects anonymous request', async ({ request }) => {
  const response = await request.get('/api/auth/me');
  expect(response.status()).toBe(401);
});
