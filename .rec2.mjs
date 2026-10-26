import { chromium } from '@playwright/test';
const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 1400, height: 900 }, acceptDownloads: true });
const logs = [];
page.on('console', (m) => { if (m.text().startsWith('DBG') || m.type() === 'error') logs.push(m.text()); });
page.on('pageerror', (e) => logs.push('pageerror ' + e.message));
page.on('download', (d) => logs.push('download ' + d.suggestedFilename()));
await page.goto('http://localhost:3300');
await page.locator('.stage canvas').waitFor({ timeout: 90000 });
await page.getByRole('button', { name: 'New pose', exact: true }).click();
await page.getByRole('menuitem', { name: 'Boxing exchange' }).click();
await page.keyboard.press('Control+e');
await page.getByRole('radio', { name: 'Video' }).click();
await page.getByRole('button', { name: 'Record video' }).click();
for (let i = 0; i < 8; i++) { await page.waitForTimeout(2500); logs.push(`t${i}: ` + (await page.locator('.modal footer .btn.primary').textContent().catch(() => 'closed')) + ' toasts=' + (await page.locator('.toast').allTextContents()).join('|')); }
console.log(logs.join('\n'));
await browser.close();
