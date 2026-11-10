// API 客户端（FE-400）：同源 fetch + Cookie 会话。CSRF 令牌只放内存；错误码的跳转、step-up 弹框、重放都在这里。
// 浏览器里没有任何 IM 管理密钥：这里只调用 /console/api/*。

export class ApiError extends Error {
  status: number;
  code: number;
  reason?: string;
  details?: Record<string, unknown>;
  constructor(status: number, code: number, msg: string, reason?: string, details?: Record<string, unknown>) {
    super(msg);
    this.status = status;
    this.code = code;
    this.reason = reason;
    this.details = details;
  }
}

/** 用户取消了 step-up 弹框：调用方什么都不用提示。 */
export const CANCELLED = -1;
/** 网络不通。 */
export const NETWORK = 0;

export interface Hooks {
  onAuthRequired(reason: string): void;
  onSetupRequired(): void;
  /** 弹 TOTP 框。验证通过 resolve true，取消 resolve false。 */
  requestStepUp(): Promise<boolean>;
}

let hooks: Hooks | null = null;
let csrfToken = '';

export function setHooks(h: Hooks | null) {
  hooks = h;
}

/** 只测试用：让测试之间互不影响。 */
export function resetClient() {
  csrfToken = '';
  hooks = null;
}

export interface CallOptions {
  /** 自动刷新、轮询：不算用户活动，不续期空闲超时（F-CON-05）。 */
  background?: boolean;
  /** 这个请求自己处理 4014 / 4038（登录、step-up 验证本身）。 */
  raw?: boolean;
}

function isSafe(method: string) {
  return method === 'GET' || method === 'HEAD';
}

async function send(method: string, path: string, body: unknown, opts: CallOptions): Promise<Response> {
  const headers: Record<string, string> = {};
  let payload: BodyInit | undefined;
  if (body instanceof FormData) {
    payload = body;
  } else if (body !== undefined) {
    headers['Content-Type'] = 'application/json';
    payload = JSON.stringify(body);
  }
  if (!isSafe(method) && csrfToken) headers['X-CSRF-Token'] = csrfToken;
  if (opts.background) headers['X-Console-Background'] = '1';
  try {
    return await fetch(path, { method, headers, body: payload, credentials: 'same-origin' });
  } catch {
    throw new ApiError(0, NETWORK, 'network error');
  }
}

async function readJSON(resp: Response): Promise<Record<string, unknown>> {
  const text = await resp.text();
  try {
    return text ? JSON.parse(text) : {};
  } catch {
    // 反向代理的错误页不是 JSON
    return {};
  }
}

function toError(resp: Response, data: Record<string, unknown>): ApiError {
  const code = typeof data.code === 'number' ? data.code : resp.status * 10;
  return new ApiError(
    resp.status,
    code,
    String(data.msg ?? ''),
    data.reason as string | undefined,
    data.details as Record<string, unknown> | undefined,
  );
}

async function parse<T>(resp: Response): Promise<T> {
  const data = await readJSON(resp);
  if (!resp.ok) throw toError(resp, data);
  if (typeof data.csrfToken === 'string') csrfToken = data.csrfToken;
  return data as T;
}

/** 成功是字节流（取文件，CS-202）：错误仍是 JSON，按同样的码处理。 */
async function parseBlob(resp: Response): Promise<Blob> {
  if (!resp.ok) throw toError(resp, await readJSON(resp));
  try {
    return await resp.blob();
  } catch {
    // 状态码 200 已经发出、传到一半断了（console 问题 17）：按网络错误，页面不保存残缺的文件。
    throw new ApiError(resp.status, NETWORK, 'incomplete');
  }
}

export async function refreshSession<T = unknown>(opts: CallOptions = {}): Promise<T> {
  return parse<T>(await send('GET', '/console/api/session', undefined, opts));
}

export async function api<T = Record<string, unknown>>(
  method: string,
  path: string,
  body?: unknown,
  opts: CallOptions = {},
): Promise<T> {
  return call(method, path, body, opts, (resp) => parse<T>(resp));
}

/**
 * 和 api 相同（CSRF、4014、4037 重放、4038 step-up），成功时返回字节（Blob）。
 * 用于经 console-server 代理取文件（CS-202）：响应是 attachment，页面不内联渲染。
 */
export async function apiBlob(method: string, path: string, body?: unknown, opts: CallOptions = {}): Promise<Blob> {
  return call(method, path, body, opts, parseBlob);
}

async function call<T>(
  method: string,
  path: string,
  body: unknown,
  opts: CallOptions,
  read: (resp: Response) => Promise<T>,
): Promise<T> {
  // 刷新页面后内存里没有令牌：写操作之前先取（AC-CON-05-10）。
  if (!isSafe(method) && !csrfToken && !opts.raw) await refreshSession().catch(() => undefined);
  let replayedCsrf = false;
  let replayedStepUp = false;
  for (;;) {
    try {
      return await read(await send(method, path, body, opts));
    } catch (err) {
      if (!(err instanceof ApiError) || opts.raw) throw err;
      if (err.code === 4014) {
        hooks?.onAuthRequired(err.reason ?? 'none');
        throw err;
      }
      if (err.code === 4016) {
        hooks?.onSetupRequired();
        throw err;
      }
      if (err.code === 4037 && !replayedCsrf) {
        // 令牌过期：重新取 session 后重放一次，仍失败才提示刷新。
        replayedCsrf = true;
        await refreshSession();
        continue;
      }
      if (err.code === 4038 && !replayedStepUp && hooks) {
        replayedStepUp = true;
        if (!(await hooks.requestStepUp())) throw new ApiError(403, CANCELLED, 'cancelled');
        continue; // 验证通过后自动重放，不需要再点一次（AC-CON-07-3）
      }
      throw err;
    }
  }
}
