import { test, expect } from '@playwright/test';

// 文档 ACL 可视化编辑器：管理员在界面上勾选成员并保存。
// 需要 E2E_USERNAME / E2E_PASSWORD（管理员账号），否则跳过。
const user = process.env.E2E_USERNAME;
const pass = process.env.E2E_PASSWORD;

test.describe('document ACL editor', () => {
  test.skip(!user || !pass, 'E2E_USERNAME / E2E_PASSWORD not set');

  test('admin can open the ACL editor and see member candidates', async ({ page }) => {
    await page.goto('/');
    await page.fill('#username', user);
    await page.fill('#password', pass);
    await page.click('#loginForm button');
    await expect(page.locator('#workspace')).toBeVisible({ timeout: 15000 });

    // 切到文档管理页签，等待文档列表加载。
    await page.click('[data-tab="documents"]');
    const accessButton = page.locator('#documentRows button[data-access]').first();
    await expect(accessButton).toBeVisible({ timeout: 15000 });
    await accessButton.click();

    // 编辑器应展开，并至少渲染出一个候选成员复选框。
    await expect(page.locator('#aclEditor')).toBeVisible();
    await expect(page.locator('#aclList input[data-user]').first()).toBeVisible();

    // 搜索过滤应生效。
    await page.fill('#aclSearch', 'zzz-no-such-user-zzz');
    await expect(page.locator('#aclList')).toContainText('没有匹配的成员');
    await page.fill('#aclSearch', '');

    // 勾选第一个成员并保存，状态栏应给出成功提示。
    await page.locator('#aclList input[data-user]:not([disabled])').first().check();
    await page.click('#aclSave');
    await expect(page.locator('#aclStatus')).toContainText('已保存', { timeout: 15000 });
  });
});
