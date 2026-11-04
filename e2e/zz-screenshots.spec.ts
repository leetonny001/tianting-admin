import { expect, test } from '@playwright/test';
import { imGroup, imUsers, login, provision, uid } from './helpers';

// 人工看样式用：SHOTS=目录 npx playwright test e2e/zz-screenshots.spec.ts
test.skip(!process.env.SHOTS, 'SHOTS=dir 才截图');
test('screens', async ({ page }) => {
  const dir = process.env.SHOTS!;
  const op = await provision('yunying', 'operator', 'support');
  const p = uid('demo');
  await imUsers([
    { userId: `${p}01`, nickname: '小明' },
    { userId: `${p}02`, nickname: 'Tom' },
    { userId: `${p}03`, nickname: '客服小助手' },
  ]);
  await imGroup(`${p}-g`, '春季活动群', [`${p}01`, `${p}02`, `${p}03`]);
  await page.goto('/login');
  await page.screenshot({ path: `${dir}/login.png` });
  await login(page, op);
  await page.goto(`/users?q=${p}`);
  await expect(page.getByRole('link', { name: `${p}01` })).toBeVisible();
  await page.screenshot({ path: `${dir}/users.png` });
  await page.goto(`/users/${p}01`);
  await expect(page.getByRole('button', { name: '强制下线' })).toBeVisible();
  await page.getByRole('button', { name: '强制下线' }).click();
  await page.screenshot({ path: `${dir}/kick.png` });
  await page.goto(`/groups/${p}-g`);
  await expect(page.getByRole('button', { name: '解散群' })).toBeVisible();
  await page.screenshot({ path: `${dir}/group.png`, fullPage: true });
});
