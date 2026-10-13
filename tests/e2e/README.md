# Playwright 端到端测试

## 安装

```powershell
npm install -D @playwright/test
npx playwright install chromium
```

## 运行

启动 Compose 后执行：

```powershell
$env:BASE_URL = "http://localhost:8080"
$env:E2E_USERNAME = "admin"
$env:E2E_PASSWORD = "你的管理员密码"
npx playwright test -c tests/e2e/playwright.config.js
```

## 覆盖范围

- 登录页渲染
- /health 冒烟
- 未登录访问受保护接口返回 401
- 登录 -> 上传 -> 提问 -> 引用（需提供账号）

## 说明

未设置 E2E_USERNAME / E2E_PASSWORD 时，主流程用例自动跳过，只运行冒烟用例。
