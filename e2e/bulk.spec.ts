import { expect, test } from '@playwright/test';
import { imUsers, login, freshOtp, provision, REASON, uid, watchPage } from './helpers';

const upload = (name: string, csv: string) => ({ name, mimeType: 'text/csv', buffer: Buffer.from(csv) });

test('用户导入：错误列表、超限、1200 行成功（AC-ADM-11-1～11-3）', async ({ page }) => {
  const problems = watchPage(page);
  const op = await provision('op', 'operator');
  const p = uid('i');
  await login(page, op);
  await page.goto('/users/import');
  const header = 'userId,nickname,avatar\n';
  const bad = Array.from({ length: 40 }, (_, i) => `${p}b${i},n,`);
  bad[5] = 'has space,n,';
  bad[28] = `${p}x,${'长'.repeat(33)},`;
  await page.getByLabel('选择文件').setInputFiles(upload('bad.csv', header + bad.join('\n') + '\n'));
  const alert = page.getByRole('alert');
  await expect(alert).toContainText('第 7 行：userId 格式不正确');
  await expect(alert).toContainText('第 30 行：昵称超过 32 个字符');
  await expect(page.getByRole('button', { name: '确认导入' })).toHaveCount(0);

  const many = Array.from({ length: 5001 }, (_, i) => `${p}m${i},,`).join('\n');
  await page.getByLabel('选择文件').setInputFiles(upload('many.csv', header + many + '\n'));
  await expect(page.getByRole('alert')).toHaveText('单个文件最多 5000 行');

  const good = Array.from({ length: 1200 }, (_, i) => `${p}g${i},昵称${i},`).join('\n');
  await page.getByLabel('选择文件').setInputFiles(upload('good.csv', header + good + '\n'));
  await expect(page.getByText('校验通过，共 1200 行')).toBeVisible();
  await page.getByRole('button', { name: '确认导入' }).click();
  await page.getByRole('dialog', { name: '确认导入' }).getByRole('button', { name: '确认' }).click();
  await expect(page.getByRole('status')).toContainText('已成功 3 批 / 共 3 批');
  // 单个添加。
  await page.getByLabel('userId').fill(`${p}one`);
  await page.getByLabel('昵称').fill('单个');
  await page.getByRole('button', { name: '校验' }).click();
  await expect(page.getByText('校验通过，共 1 行')).toBeVisible();
  expect(problems).toEqual([]);
});

test('好友导入和删除：备注不出现、step-up、错误文案（AC-ADM-15-1、15-2、15-5）', async ({ page }) => {
  const op = await provision('op', 'operator');
  const p = uid('f');
  const [a, b, c] = [`${p}alice`, `${p}bob`, `${p}carol`];
  await imUsers([{ userId: a }, { userId: b }, { userId: c }]);
  await login(page, op);
  await page.goto('/social/friends');
  const csv = `${a},${b},ZXQ-REMARK-789,\n${a},${c},,\n`;
  await page.getByLabel('选择文件').setInputFiles(upload('f.csv', csv));
  await expect(page.getByText('校验通过，共 2 行')).toBeVisible();
  await expect(page.locator('body')).not.toContainText('ZXQ-REMARK-789');
  await page.getByRole('button', { name: '确认导入' }).click();
  const d = page.getByRole('dialog', { name: '确认导入好友' });
  await expect(d).toContainText('将为 2 对用户建立双向好友关系，不受拉黑影响，也不解除拉黑');
  await d.getByLabel('理由').fill(REASON);
  await d.getByRole('button', { name: '确认' }).click();
  const su = page.getByRole('dialog', { name: '输入动态码确认' });
  await su.getByLabel('动态码').fill(await freshOtp(op.seed));
  await su.getByRole('button', { name: '验证' }).click();
  await expect(page.getByRole('status')).toContainText('已成功 1 批 / 共 1 批');

  // 第 2 批有不存在的用户。
  const n = 1200;
  const people = Array.from({ length: n + 1 }, (_, i) => `${p}p${i}`);
  await imUsers(people.slice(0, 500).map((userId) => ({ userId })));
  await imUsers(people.slice(500, 1000).map((userId) => ({ userId })));
  await imUsers(people.slice(1000).map((userId) => ({ userId })));
  const pairs = Array.from({ length: n }, (_, i) => `${people[i]},${people[i + 1]}`);
  const ghost = `${p}ghost`;
  pairs[700] = `${people[700]},${ghost}`;
  await page.getByLabel('选择文件').setInputFiles(upload('big.csv', pairs.join('\n') + '\n'));
  await expect(page.getByText(`校验通过，共 ${n} 行`)).toBeVisible();
  await page.getByRole('button', { name: '确认导入' }).click();
  const d2 = page.getByRole('dialog', { name: '确认导入好友' });
  await d2.getByLabel('理由').fill(REASON);
  await d2.getByRole('button', { name: '确认' }).click();
  await expect(page.getByRole('alert')).toContainText('已成功 1 批 / 共 3 批');
  await expect(page.getByRole('alert')).toContainText(`用户不存在：${ghost}`);

  // 好友列表没有备注列。
  await page.goto(`/users/${a}`);
  await page.getByRole('button', { name: '查看好友列表' }).click();
  await expect(page.getByRole('cell', { name: b })).toBeVisible();
  await expect(page.getByRole('cell', { name: '后台导入' }).first()).toBeVisible();
  await expect(page.getByRole('columnheader', { name: /备注/ })).toHaveCount(0);

  // 删除。
  await page.goto('/social/friends');
  await page.getByRole('tab', { name: '删除好友' }).click();
  await page.getByLabel('选择文件').setInputFiles(upload('d.csv', `${a},${b}\n`));
  await page.getByRole('button', { name: '确认删除' }).click();
  const del = page.getByRole('dialog', { name: '确认删除好友' });
  await del.getByLabel('理由').fill(REASON);
  await del.getByRole('button', { name: '确认' }).click();
  await expect(page.getByRole('status')).toContainText('已成功 1 批 / 共 1 批');
});

test('社交配置：差异、确认文字（AC-ADM-16-1、16-2）', async ({ page }) => {
  const op = await provision('op', 'operator');
  await login(page, op);
  await page.goto('/social/settings');
  const mode = page.getByLabel('好友模式');
  const before = await mode.inputValue();
  const after = before === 'friends' ? 'open' : 'friends';
  await expect(page.getByRole('button', { name: '保存' })).toBeDisabled();
  await mode.selectOption(after);
  await page.getByRole('button', { name: '保存' }).click();
  const d = page.getByRole('dialog', { name: '确认修改社交配置' });
  await expect(d).toContainText(`好友模式：${before} → ${after}`);
  await d.getByLabel('理由').fill(REASON);
  await d.getByLabel(`请输入 ${after} 确认`).fill(after.slice(0, -1));
  await expect(d.getByRole('button', { name: '确认' })).toBeDisabled();
  await d.getByLabel(`请输入 ${after} 确认`).fill(after);
  await d.getByRole('button', { name: '确认' }).click();
  const su = page.getByRole('dialog', { name: '输入动态码确认' });
  await su.getByLabel('动态码').fill(await freshOtp(op.seed));
  await su.getByRole('button', { name: '验证' }).click();
  await expect(page.getByText('已保存')).toBeVisible();
  await expect(page.getByRole('row').filter({ hasText: '好友模式' }).getByRole('cell').nth(1)).toHaveText(after);
  // 还原。
  await mode.selectOption(before);
  await page.getByRole('button', { name: '保存' }).click();
  const back = page.getByRole('dialog', { name: '确认修改社交配置' });
  await back.getByLabel('理由').fill(REASON);
  await back.getByLabel(`请输入 ${before} 确认`).fill(before);
  await back.getByRole('button', { name: '确认' }).click();
  await expect(page.getByText('已保存')).toBeVisible();
});
