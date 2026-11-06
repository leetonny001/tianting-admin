// 邀请码（PRD-chat F-ACC-09）：状态和表单校验。都是纯函数，页面只负责显示。
import { toLocalInput } from './format';
import type { InviteRow } from '../api/types';

export const INVITE_BATCH_MAX = 100;
export const INVITE_MAX_USES_MAX = 1000;
export const INVITE_NOTE_MAX = 200;
const DEFAULT_EXPIRES_DAYS = 7;

export type InviteStatus = 'autoDisabled' | 'disabled' | 'expired' | 'usedUp' | 'active';

/** 接口只给字段，状态由这里算。和 im-server 的 InviteUsable 一致：`expiresAt` 正好等于现在算过期，已用次数到上限算用完。 */
export function inviteStatus(inv: InviteRow, now: number): InviteStatus {
  if (inv.autoDisabled) return 'autoDisabled';
  if (inv.disabledAt) return 'disabled';
  if (inv.expiresAt <= now) return 'expired';
  if (inv.usedCount >= inv.maxUses) return 'usedUp';
  return 'active';
}

export const inviteStatusText: Record<InviteStatus, string> = {
  autoDisabled: '已停用（自动）',
  disabled: '已停用',
  expired: '已过期',
  usedUp: '已用完',
  active: '可用',
};

export const inviteStatusTone: Record<InviteStatus, 'neutral' | 'good' | 'warn' | 'bad'> = {
  autoDisabled: 'bad',
  disabled: 'neutral',
  expired: 'neutral',
  usedUp: 'neutral',
  active: 'good',
};

/**
 * createdBy 形如 console:admin:{账号ID}，是调用方标识，不是用户名，不显示原文。
 * 列表接口不带用户名，运营也没有查账号列表的权限（admin.manage），所以只能显示账号 ID。其他形式不猜，显示 —。
 */
export function inviteCreator(createdBy?: string): string {
  const id = /^console:admin:(.+)$/.exec(createdBy ?? '')?.[1];
  return id ? `管理员 ${id}` : '—';
}

export interface InviteForm {
  count: string;
  maxUses: string;
  expires: string; // datetime-local 的值
  note: string;
}

export function defaultInviteForm(now: number): InviteForm {
  return { count: '1', maxUses: '1', expires: toLocalInput(now + DEFAULT_EXPIRES_DAYS * 24 * 3600 * 1000), note: '' };
}

function intInRange(raw: string, max: number): number | null {
  const text = raw.trim();
  if (!/^\d+$/.test(text)) return null;
  const n = Number(text);
  return n >= 1 && n <= max ? n : null;
}

export interface InviteFormResult {
  errors: { count?: string; maxUses?: string; expires?: string; note?: string };
  /** 没有错误时才有。 */
  payload?: { count: number; maxUses: number; expiresAt: number; note?: string };
}

/** 和 im-server 相同的范围，前端先挡一次（F-ACC-09 规则 1）。备注和服务端一样按字符数算。 */
export function checkInviteForm(form: InviteForm, now: number): InviteFormResult {
  const count = intInRange(form.count, INVITE_BATCH_MAX);
  const maxUses = intInRange(form.maxUses, INVITE_MAX_USES_MAX);
  const expiresAt = new Date(form.expires).getTime();
  const note = form.note.trim();
  const errors: InviteFormResult['errors'] = {};
  if (count === null) errors.count = `数量需要在 1～${INVITE_BATCH_MAX} 之间`;
  if (maxUses === null) errors.maxUses = `可用次数需要在 1～${INVITE_MAX_USES_MAX} 之间`;
  if (!(expiresAt > now)) errors.expires = '到期时间要晚于现在';
  if ([...note].length > INVITE_NOTE_MAX) errors.note = `备注最多 ${INVITE_NOTE_MAX} 个字`;
  if (Object.keys(errors).length > 0 || count === null || maxUses === null) return { errors };
  return { errors, payload: { count, maxUses, expiresAt, ...(note ? { note } : {}) } };
}
