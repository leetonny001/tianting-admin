// 错误文案（PRD-admin 2.3 节）：按 code + reason 查表，不直接显示服务端的 msg。
// 例外：msg 里写明了是哪个用户的，只取出 userId 这一段。
import { ApiError, NETWORK } from './client';

const byReason: Record<string, string> = {
  reasonInvalid: '理由需要 4～200 个字符，不能由同一个字符重复组成',
  ticketInvalid: '工单号格式不正确',
  confirmMismatch: '确认文字不一致',
  importTokenInvalid: '校验结果已失效，请重新上传文件',
  fileChanged: '文件和校验时不一致，请重新上传校验',
  notAvailable: '该功能尚未在服务端开放',
  c2cBodyDisabled: '单聊正文查看未开启',
  tooShort: '密码太短，至少 12 位',
  tooLong: '密码太长',
  containsUsername: '密码不能包含账号名',
  weak: '密码太常见，请换一个',
  reused: '不能使用最近用过的密码',
  pushAllInterval: '全员通知间隔不少于 5 分钟',
  pushResultUnknown: '结果未知，系统会自动确认，请稍后查看发送记录',
  pushTooManyUsers: '单次最多 1000 个用户',
  templateUnknown: '通知模板不存在',
  dataInvalid: '通知内容不符合模板要求',
  dataTooLarge: '通知内容不能超过 4KB',
  draftExpired: '草稿已超过 24 小时，已作废，请重新发起',
  draftClosed: '这份草稿已经批准过了',
  ownDraft: '不能批准自己发起的草稿',
};

const byCode: Record<number, string> = {
  4000: '参数不正确',
  4004: 'ID 格式不正确，只能用字母、数字、_、-，最长 64 位',
  4007: '会话 ID 格式不正确',
  4015: '账号、密码或动态码错误',
  4030: '没有权限',
  4037: '页面已过期，请刷新后重试',
  4040: '没有找到',
  4042: '用户不存在',
  4043: '群不存在或已解散',
  4044: '消息不存在或已过期',
  4046: '该用户不是群成员',
  4048: '文件不存在或已过了保留期',
  4090: '群 ID 已存在',
  4092: '账号名已存在',
  4098: '举报已被处理',
  4093: '账号状态不允许这个操作',
  4130: '群成员最多 2000 人',
  4131: '单个文件最多 5000 行',
  4132: '好友数已达上限',
  4290: '操作太频繁，请稍后再试',
  4291: '尝试次数过多，请稍后再试',
  4292: '今天的查询次数已达上限',
  5000: '服务端出错了，请稍后再试',
  5030: '服务暂时不可用，请稍后再试',
  5031: '审计服务不可用，操作未执行',
  5040: '操作结果未知，请刷新确认，不要重复提交',
};

/** 服务端 msg 形如 "user ghost not found"：只取 userId，其余不显示。 */
export function userIdFromMsg(msg: string): string | null {
  return /\buser ([A-Za-z0-9_-]+)\b/.exec(msg)?.[1] ?? null;
}

/** 按码出文案。msg 是 im-server 的原文，只用来取 userId。 */
export function textForCode(code: number, msg = '', reason?: string): string {
  if (reason && byReason[reason]) return byReason[reason];
  const id = userIdFromMsg(msg);
  if (code === 4042 && id) return `用户不存在：${id}`;
  if (code === 4132 && id) return `${id} 的好友数已达上限`;
  return byCode[code] ?? `操作失败（错误码 ${code}）`;
}

export function errorText(err: unknown): string {
  if (!(err instanceof ApiError)) return '出错了，请重试';
  if (err.code === NETWORK) return '网络不通，请检查 VPN 后重试';
  if (err.code === 4291) {
    const seconds = Number(err.details?.retryAfterSeconds ?? 0);
    if (seconds > 0) return `尝试次数过多，请 ${Math.ceil(seconds / 60)} 分钟后再试`;
  }
  return textForCode(err.code, err.message, err.reason);
}

/**
 * 生成邀请码的错误文案：4131、4000 在表里是别的页面的意思（文件行数、通用参数），这里说清楚。其余走表。
 * 5031 的"操作未执行"走表，不覆盖。
 */
export function inviteErrorText(err: unknown): string {
  if (err instanceof ApiError && err.code === 4131) return '单次最多生成 100 个邀请码';
  if (err instanceof ApiError && err.code === 4000) {
    return '可用次数、到期时间或备注不符合要求：可用次数 1～1000，到期时间要晚于现在，备注最多 200 个字';
  }
  return errorText(err);
}

/**
 * 生成请求的结果是否未知：im-server 可能已经生成，明文只在那次响应里，找不回（console-chat 问题 3）。
 * 5040 是 console 明确说的；网络断开和网关的 502 同样收不到响应，按最保守的理解一起处理。
 */
export function inviteResultUnknown(err: unknown): boolean {
  return err instanceof ApiError && (err.code === 5040 || err.code === NETWORK || err.code === 5020);
}

/** 被退出登录的原因（登录页顶部显示）。 */
export function signedOutText(reason: string | null): string | null {
  switch (reason) {
    case 'replaced':
      return '你的账号在别处登录，本次登录已退出';
    case 'idle':
      return '长时间没有操作，请重新登录';
    case 'absolute':
      return '登录已超过 12 小时，请重新登录';
    case 'revoked':
      return '你的账号状态或权限有变化，请重新登录';
    default:
      return null;
  }
}
