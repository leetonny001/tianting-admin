// FE-698：C6 跨端的管理后台一段（AC-MOD-04-1 的完整流程、AC-MOD-03-11 的审核员一侧）。三端（H5、Android、iOS）和这里连同一个
// im-server（tianting-android 的 scripts/test-server.sh，TT_EXTRA_CALLERS 加了 console、console-msgread 两个调用方），console-server
// 由协调脚本另外起好（托管本仓库的 dist，响应头是生产 CSP），e2e/.state.json 也由它写。共同约定（tianting-web 的
// e2e/xp-c6.spec.ts、tianting-android 的 CrossPlatformC6E2e、tianting-ios 的 CrossPlatformC6E2ETests 照抄这一段）：
//   - 运行号 R；端 P = h5、android、ios。每个举报端 X 一个方向（信号的命名空间就是 X）：举报人 rX = xp{R}r{X}，被举报人 vX = xp{R}v{X}
//     （昵称就是 userId）；vX 同时登录在另外两端（接收端 Y、Z，同一个用户的两台设备）。另有 o = xp{R}o（群里发言、撤回）、
//     s = xp{R}s（哨兵）、群 G = xp{R}g「C6群-{R}」（o、rh5、randroid、rios），特征词 W = zxqword{R}（测试里现场加进词库，不是真实词）。
//     协调脚本先放好：vX 给 rX 发「XP6-v-{X}」；o 在 G 发「XP6-M-{R}」，再按 h5、android、ios 的顺序发「XP6-R-{X}」；等 W 生效。
//   - 接收端（vX 在 Y）：① 登录，列表里 rX 的会话摘要是「XP6-v-{X}」、未读 1；停在列表；贴 ready-{Y}，等另一个接收端的 ready
//     （它登录会给这边发新设备提醒，要在开始记录之前），开始记录下行（H5 记 WebSocket 帧、Android 记 SDK 事件、iOS 在中转上记帧），
//     贴 armed-{Y}。② 等到 reported（t0）：协调脚本紧接着让 s 给 vX 发哨兵「XP6-s1-{X}」：2 秒内哨兵出现在列表；等到 t0 + 2 秒，
//     记录到的下行都只和哨兵的会话有关（AC-MOD-03-1、F-MOD-03 规则 7：被举报人收不到任何帧），rX 的会话不变；贴 s1-ok-{Y}，重新开始记录。
//     ③ 等到 blocked（t0）：哨兵「XP6-s2-{X}」，同样 2 秒内出现、到 t0 + 2 秒只有哨兵，rX 的会话不变；打开 rX 的会话，只有
//     「XP6-v-{X}」，没有含 W 的消息（AC-MOD-02-1 的客户端部分）；贴 obs-done-{Y}。
//   - 举报端（rX 在 X）：① 登录，打开 vX 的会话看到「XP6-v-{X}」；等两个接收端的 armed。② 消息菜单「举报」→ 辱骂骚扰 → 提交，
//     轻提示「已提交，感谢你的反馈」、询问拉黑（点取消）；贴 reported。③ 等两个接收端的 s1-ok；发「XP6 含 {W}」：失败、提示
//     「消息包含不当内容，无法发送」、输入框清空；贴 blocked。④ 等两个接收端的 obs-done；打开 G，看到「XP6-M-{R}」「XP6-R-{X}」，
//     停 2 秒让已读报上去，贴 g-seen；协调脚本让 o 撤回「XP6-R-{X}」，贴 recalled（带 msgId）；最后一条撤回提示行的「举报」→ 其他 →
//     提交成功、不问拉黑（AC-MOD-03-11）；「XP6-M-{R}」的菜单「举报」→ 垃圾广告 → 提交成功（AC-MOD-04-1 的三端各举报一次）；贴 r-done。
//   - 最后一段（命名空间 final，三端同时在线）：各端以 rX 登录、打开 G、看到「XP6-M-{R}」，贴 f-ready-{X}；管理后台（审核员）看队列里
//     「XP6-M-{R}」那一行聚合"3 次"、授权看证据（水印）、删除这条消息，点最后一下之前贴 deleting；各端等到 deleting（t0）后
//     「XP6-M-{R}」消失、显示「该消息已被删除」，贴 f-done-{X}（带 ms）；后台结案。
//   - 反证：协调脚本 --fake X:report（没有举报端，协调脚本以 rX 给 vX 发一条再贴 reported）→ 接收端必须在 ② 失败；
//     --fake X:block（协调脚本真的举报，再以 rX 发一条普通消息后贴 blocked）→ 接收端必须在 ③ 失败。
// 这里多用一个信号 final/seed（协调脚本启动时贴）：{m, mSeq, rh5, randroid, rios}，是「XP6-M-{R}」和三条「XP6-R-{X}」的 msgId。
// 环境变量：TT_XP（运行号）、TT_XP_COORD（信号板）。没有时跳过。配置见 playwright.xp.config.ts。结果是 Chrome，本地。
import { expect, test, type Page } from '@playwright/test';
import { clockNow, freshOtp, login, loginApi, provision, watchPage, type Account } from './helpers';

const RUN = process.env.TT_XP ?? '';
const COORD = process.env.TT_XP_COORD ?? '';
const P = ['h5', 'android', 'ios'];
const G = `group:xp${RUN}g`;
const O = `xp${RUN}o`;
const REASON = '核实跨端举报';

async function post(name: string, body: unknown = {}) {
  const res = await fetch(`${COORD}/s/final/${name}`, { method: 'POST', body: JSON.stringify(body) });
  expect(res.ok, `signal ${name}`).toBe(true);
}
async function wait(name: string, ms = 900_000): Promise<Record<string, string>> {
  const res = await fetch(`${COORD}/s/final/${name}?t=${ms}`, { signal: AbortSignal.timeout(ms + 5000) });
  expect(res.status, `等信号 ${name}`).toBe(200);
  return ((await res.json()) as { body: Record<string, string> }).body;
}

const queue = (page: Page) => page.getByRole('table', { name: '举报队列' });
const rowOf = (page: Page, msgId: string) =>
  queue(page)
    .getByRole('row')
    .filter({ hasText: `群消息 ${G} / ${msgId}` });

async function toQueue(page: Page) {
  await page.getByRole('navigation', { name: '主菜单' }).getByRole('link', { name: '举报' }).click();
  await expect(page.getByLabel('状态')).toHaveValue('pending');
}

/** 展开这一行，返回每条举报的 ID。 */
async function reportsOf(page: Page, msgId: string): Promise<string[]> {
  const row = rowOf(page, msgId);
  await expect(row).toHaveCount(1);
  await row.getByRole('button', { name: '查看每条' }).click();
  const links = row.getByRole('list', { name: '每条举报' }).getByRole('link');
  return links.allTextContents();
}

async function grant(page: Page, a: Account, reportId: string) {
  await page.getByRole('button', { name: '查看证据' }).click();
  const dlg = page.getByRole('dialog', { name: '查看举报证据' });
  await expect(dlg.getByLabel('工单号')).toHaveValue(reportId);
  await dlg.getByLabel('理由').fill(REASON);
  await dlg.getByLabel('动态码').fill(await freshOtp(a.seed));
  await dlg.getByRole('button', { name: '查看' }).click();
  await expect(dlg).toHaveCount(0);
}

async function watermark(page: Page, a: Account) {
  const wm = page.getByTestId('watermark');
  await expect(wm.locator('span').first()).toHaveText(
    new RegExp(`^${a.username} \\d{4}-\\d{2}-\\d{2} \\d{2}:\\d{2} \\S{8}$`),
  );
  expect(await wm.locator('span').count()).toBeGreaterThan(10);
}

test.describe('FE-698 C6 跨端（管理后台）', () => {
  test.skip(!RUN || !COORD, '跨端用例要协调脚本传 TT_XP、TT_XP_COORD');

  test('AC-MOD-04-1、AC-MOD-03-11、AC-MOD-04-6（跨端）：三端各举报一次 → 队列聚合 3 次 → 授权读证据（水印）→ 删除消息（三端消失）→ 结案', async ({
    page,
  }) => {
    test.setTimeout(1_200_000);
    const problems = watchPage(page);
    const seed = await wait('seed', 60_000);
    const mod = await provision('xm', 'moderator');
    for (const x of P) await wait(`f-ready-${x}`);
    await login(page, mod);
    await toQueue(page);

    // 撤回的群消息：三端各举报了自己那条，审核员读到隔离原文（AC-MOD-03-11）。
    for (const x of P) {
      const ids = await reportsOf(page, seed[`r${x}`]!);
      expect(ids, `XP6-R-${x} 的举报`).toHaveLength(1);
      await expect(rowOf(page, seed[`r${x}`]!)).toContainText('1 次');
      await rowOf(page, seed[`r${x}`]!).getByRole('link', { name: ids[0]!, exact: true }).click();
      await expect(page.locator('dl.kv')).toContainText(`举报人xp${RUN}r${x}`);
      await expect(page.locator('dl.kv')).toContainText(`被举报人${O}`);
      await expect(page.locator('dl.kv')).toContainText('理由其他');
      await grant(page, mod, ids[0]!);
      await expect(page.getByText(new RegExp(`^已撤回（${O}，.+），以下是隔离原文$`))).toBeVisible();
      await expect(page.getByText(`XP6-R-${x}`, { exact: true })).toBeVisible();
      await watermark(page, mod);
      await toQueue(page);
    }

    // AC-MOD-04-1：同一条群消息被三端各举报一次，队列聚合"3 次"，点开 3 条（AC-MOD-04-6）。
    const row = rowOf(page, seed.m!);
    await expect(row).toContainText('3 次');
    const ids = await reportsOf(page, seed.m!);
    expect(ids).toHaveLength(3);
    const each = row.getByRole('list', { name: '每条举报' }).getByRole('listitem');
    await expect(each.filter({ hasText: '垃圾广告 · 待处理' })).toHaveCount(3);
    await row.getByRole('link', { name: ids[0]!, exact: true }).click();
    await expect(page.getByRole('heading', { name: `举报单 ${ids[0]}` })).toBeVisible();
    await expect(page.locator('dl.kv')).toContainText(`被举报人${O}`);
    await expect(page.locator('body')).not.toContainText(`XP6-M-${RUN}`); // 授权前没有正文
    await grant(page, mod, ids[0]!);
    await expect(page.getByText(`XP6-M-${RUN}`, { exact: true })).toBeVisible();
    await watermark(page, mod);

    // 删除消息：处置只是链接，到正文页走现有的授权、确认和动态码（F-MOD-04 规则 5）。
    await page.getByRole('list', { name: '处置' }).getByRole('link', { name: '删除消息' }).click();
    const body = page.getByRole('dialog');
    await expect(body).toBeVisible();
    await body.getByLabel('工单号').fill('T-698'); // 正文页的工单号有格式要求，举报 ID 不符合
    await body.getByLabel('理由').fill(REASON);
    await body.getByLabel('动态码').fill(await freshOtp(mod.seed));
    await body.getByRole('button', { name: '查看' }).click();
    await expect(page.getByText(`XP6-M-${RUN}`).first()).toBeVisible();
    await page.getByRole('checkbox', { name: `选择第 ${seed.mSeq} 条` }).check();
    await page.getByRole('button', { name: /删除所选/ }).click();
    await page.getByLabel('理由').fill(REASON);
    await page.getByRole('dialog').getByRole('button', { name: '删除' }).click();
    await page.getByRole('textbox', { name: '动态码' }).fill(await freshOtp(mod.seed));
    await post('deleting');
    await page.getByRole('dialog', { name: '输入动态码确认' }).getByRole('button', { name: '验证' }).click();
    await expect(page.getByText(/该消息已被删除/).first()).toBeVisible();
    const done: Record<string, number> = {};
    for (const x of P) done[x] = Number((await wait(`f-done-${x}`, 60_000)).ms);
    console.log(`TT-E2E-XP6 final deleted ms ${JSON.stringify(done)}`);
    for (const x of P) expect(done[x], `${x} 10 秒内`).toBeLessThan(10_000);

    // 结案：三条都"已处理"。
    for (const id of ids) {
      await page.goto(`/reports/${id}`);
      await expect(page.locator('dl.kv')).toContainText('状态待处理');
      await page.getByRole('button', { name: '已处理' }).click();
      const dlg = page.getByRole('dialog', { name: '结案：已处理' });
      await dlg.getByLabel('理由').fill('已删除违规消息');
      await dlg.getByRole('button', { name: '已处理' }).click();
      await expect(page.getByText('已结案')).toBeVisible();
      await expect(page.locator('dl.kv')).toContainText('状态已处理');
    }
    await toQueue(page);
    await expect(rowOf(page, seed.m!)).toHaveCount(0);
    await page.getByLabel('状态').selectOption({ label: '全部' });
    await page.getByRole('button', { name: '筛选' }).click();
    await expect(rowOf(page, seed.m!)).toContainText('3 次');
    // console 审计（TC-MOD-04-01）：这个审核员的操作按顺序是 report.view → report.evidence.grant → msg.delete → report.handle（各取第一次）。
    const aud = await provision('xa', 'auditor');
    const now = clockNow();
    const audit = await (
      await loginApi(aud)
    ).call<{ records: { action: string; accountId: string; phase: string }[] }>(
      'GET',
      `/console/api/audit?from=${now - 6 * 3600_000}&to=${now + 60_000}&limit=200`,
    );
    const mine = audit.records.filter((x) => x.accountId === mod.id && x.phase === 'result').reverse();
    const firstOf = (a: string) => mine.findIndex((x) => x.action === a);
    const order = ['report.view', 'report.evidence.grant', 'msg.delete', 'report.handle'].map(firstOf);
    expect(
      order.every((i) => i >= 0),
      JSON.stringify(mine.map((x) => x.action)),
    ).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
    expect(problems).toEqual([]);
  });
});
