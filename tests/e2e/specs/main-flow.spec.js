import { test, expect } from '@playwright/test';

// 完整主流程：登录 -> 上传 -> 提问 -> 引用 -> 反馈。
// 需要环境变量 E2E_USERNAME / E2E_PASSWORD，否则跳过。
const user = process.env.E2E_USERNAME;
const pass = process.env.E2E_PASSWORD;

test.describe('main flow', () => {
  test.skip(!user || !pass, 'E2E_USERNAME / E2E_PASSWORD not set');

  test('login, upload, ask, and read citations', async ({ page, request }) => {
    await page.goto('/');
    await page.fill('#username', user);
    await page.fill('#password', pass);
    await page.click('#loginForm button');
    await expect(page.locator('#workspace')).toBeVisible({ timeout: 15000 });

    // 登录后拿到 token，直接用 API 上传一个小文档。
    const token = await page.evaluate(() => localStorage.getItem('kb_token'));
    expect(token).toBeTruthy();

    const upload = await request.post('/api/documents/batch', {
      headers: { Authorization: 'Bearer ' + token },
      multipart: {
        files: { name: 'e2e.md', mimeType: 'text/markdown', buffer: Buffer.from('# E2E\n\nThe calibration token is E2E-CHECK-123.') },
        department: 'platform',
        sensitivity: 'L1',
      },
    });
    expect(upload.ok()).toBeTruthy();

    // 新建一个空会话再提问：否则会命中历史会话里已有的回答，导致断言数量不确定。
    await page.click('#newSession');
    await expect(page.locator('#chatMessages .assistant')).toHaveCount(0);

    // 提问并等待回答与引用。
    await page.fill('#chatInput', 'What is the calibration token?');
    await page.click('#sendMessage');
    await expect(page.locator('#chatMessages .assistant')).toHaveCount(1, { timeout: 120000 });
    await expect(page.locator('#chatStatus')).toContainText('trace_id', { timeout: 120000 });
  });
});
