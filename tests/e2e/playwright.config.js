import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './specs',
  use: { baseURL: process.env.BASE_URL || 'http://localhost:8080', headless: true },
  reporter: [['list'], ['html', { outputFolder: 'playwright-report', open: 'never' }]],
});
