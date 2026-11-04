import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { api, ApiError, CANCELLED, refreshSession, resetClient, setHooks } from './client';
import { errorText, signedOutText, textForCode, userIdFromMsg } from './errors';

type Reply = { status: number; body: unknown };
let calls: { url: string; init: RequestInit }[] = [];
let replies: Reply[] = [];

beforeEach(() => {
  calls = [];
  replies = [];
  resetClient();
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init: RequestInit) => {
      calls.push({ url, init });
      const r = replies.shift() ?? { status: 200, body: {} };
      return new Response(JSON.stringify(r.body), { status: r.status });
    }),
  );
});
afterEach(() => vi.unstubAllGlobals());

const headers = (i: number) => calls[i]!.init.headers as Record<string, string>;
const hooks = (over = {}) => ({
  onAuthRequired: vi.fn(),
  onSetupRequired: vi.fn(),
  requestStepUp: vi.fn(async () => true),
  ...over,
});

describe('api client', () => {
  it('令牌只来自 session，写操作带上；同源 Cookie', async () => {
    replies = [
      { status: 200, body: { csrfToken: 'tok' } },
      { status: 200, body: { ok: 1 } },
    ];
    await refreshSession();
    await api('POST', '/console/api/x', { a: 1 });
    expect(headers(1)['X-CSRF-Token']).toBe('tok');
    expect(calls[1]!.init.credentials).toBe('same-origin');
    expect(headers(0)['X-CSRF-Token']).toBeUndefined();
  });

  it('刷新后内存里没有令牌：第一次写操作前先取 session（AC-CON-05-10）', async () => {
    replies = [
      { status: 200, body: { csrfToken: 'new' } },
      { status: 200, body: {} },
    ];
    await api('POST', '/console/api/x', {});
    expect(calls[0]!.url).toBe('/console/api/session');
    expect(headers(1)['X-CSRF-Token']).toBe('new');
  });

  it('4038：弹框通过后重放原请求一次（AC-CON-07-3）', async () => {
    const h = hooks();
    setHooks(h);
    replies = [
      { status: 200, body: { csrfToken: 't' } },
      { status: 403, body: { code: 4038 } },
      { status: 200, body: { done: true } },
    ];
    const r = await api<{ done: boolean }>('POST', '/console/api/x', { a: 1 });
    expect(r.done).toBe(true);
    expect(h.requestStepUp).toHaveBeenCalledTimes(1);
    expect(calls[2]!.init.body).toBe(calls[1]!.init.body);
  });

  it('4038：只重放一次，不会无限弹框', async () => {
    const h = hooks();
    setHooks(h);
    replies = [
      { status: 200, body: { csrfToken: 't' } },
      { status: 403, body: { code: 4038 } },
      { status: 403, body: { code: 4038 } },
    ];
    await expect(api('POST', '/console/api/x', {})).rejects.toMatchObject({ code: 4038 });
    expect(h.requestStepUp).toHaveBeenCalledTimes(1);
  });

  it('4038：取消后不重放', async () => {
    setHooks(hooks({ requestStepUp: vi.fn(async () => false) }));
    replies = [
      { status: 200, body: { csrfToken: 't' } },
      { status: 403, body: { code: 4038 } },
    ];
    await expect(api('POST', '/console/api/x', {})).rejects.toMatchObject({ code: CANCELLED });
    expect(calls).toHaveLength(2);
  });

  it('4037：重新取 session 后重放一次，仍失败才报错', async () => {
    replies = [
      { status: 200, body: { csrfToken: 'old' } },
      { status: 403, body: { code: 4037 } },
      { status: 200, body: { csrfToken: 'new' } },
      { status: 200, body: { ok: 1 } },
    ];
    await api('POST', '/console/api/x', {});
    expect(headers(3)['X-CSRF-Token']).toBe('new');
    replies = [
      { status: 403, body: { code: 4037 } },
      { status: 200, body: { csrfToken: 'n2' } },
      { status: 403, body: { code: 4037 } },
    ];
    await expect(api('POST', '/console/api/x', {})).rejects.toMatchObject({ code: 4037 });
  });

  it('4014、4016 交给 hooks', async () => {
    const h = hooks();
    setHooks(h);
    replies = [{ status: 401, body: { code: 4014, reason: 'replaced' } }];
    await expect(api('GET', '/console/api/x')).rejects.toBeInstanceOf(ApiError);
    expect(h.onAuthRequired).toHaveBeenCalledWith('replaced');
    replies = [{ status: 401, body: { code: 4016 } }];
    await expect(api('GET', '/console/api/x')).rejects.toBeInstanceOf(ApiError);
    expect(h.onSetupRequired).toHaveBeenCalled();
  });

  it('raw：登录、step-up 自己处理错误', async () => {
    const h = hooks();
    setHooks(h);
    replies = [{ status: 401, body: { code: 4014 } }];
    await expect(api('POST', '/console/api/auth/login', {}, { raw: true })).rejects.toMatchObject({ code: 4014 });
    expect(h.onAuthRequired).not.toHaveBeenCalled();
  });

  it('轮询带后台头，用户操作不带', async () => {
    await api('GET', '/console/api/a', undefined, { background: true });
    await api('GET', '/console/api/b');
    expect(headers(0)['X-Console-Background']).toBe('1');
    expect(headers(1)['X-Console-Background']).toBeUndefined();
  });

  it('上传不设 Content-Type：浏览器要带 boundary', async () => {
    replies = [{ status: 200, body: { csrfToken: 't' } }];
    await api('POST', '/console/api/up', new FormData());
    expect(headers(1)['Content-Type']).toBeUndefined();
  });

  it('网络错误、非 JSON 错误页', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new TypeError('failed');
      }),
    );
    await expect(api('GET', '/x')).rejects.toMatchObject({ code: 0 });
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('<html>bad gateway</html>', { status: 502 })),
    );
    await expect(api('GET', '/x')).rejects.toMatchObject({ status: 502 });
  });
});

describe('error text', () => {
  it('不显示服务端 msg，只取其中的 userId', () => {
    expect(textForCode(4042, 'user ghost not found')).toBe('用户不存在：ghost');
    expect(textForCode(4132, 'user alice would exceed the friend limit')).toBe('alice 的好友数已达上限');
    expect(textForCode(4042, 'SQL error: select * from users')).toBe('用户不存在');
    expect(textForCode(5000, 'panic at server.go:42')).not.toContain('panic');
    expect(textForCode(9999, 'whatever')).toBe('操作失败（错误码 9999）');
    expect(userIdFromMsg('nothing here')).toBeNull();
  });
  it('reason 优先', () => {
    expect(textForCode(4040, '', 'notAvailable')).toBe('该功能尚未在服务端开放');
    expect(textForCode(4000, '', 'weak')).toContain('太常见');
  });
  it('关键文案', () => {
    expect(textForCode(5031)).toBe('审计服务不可用，操作未执行');
    expect(textForCode(5040)).toBe('操作结果未知，请刷新确认，不要重复提交');
    expect(signedOutText('replaced')).toBe('你的账号在别处登录，本次登录已退出');
    expect(signedOutText('none')).toBeNull();
    expect(errorText(new ApiError(429, 4291, '', undefined, { retryAfterSeconds: 870 }))).toBe(
      '尝试次数过多，请 15 分钟后再试',
    );
  });
});
