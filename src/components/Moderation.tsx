import { useState } from 'react';
import { api } from '../api/client';
import { Badge, ConfirmDialog, Field, Text } from './ui';
import { formatTime } from '../lib/format';

/** 到期时间只用 im-server 返回的值（AC-ADM-13-9 列表和详情）。null 表示永久。 */
export function untilText(until: number | null | undefined): string {
  return until == null ? '永久' : formatTime(until);
}

/** 禁言标记：mutedUntil 这个键不存在就是没有禁言；null 是永久禁言。 */
export function MutedBadge({ row }: { row: { mutedUntil?: number | null } }) {
  if (row.mutedUntil === undefined) return null;
  return <Badge tone="warn">禁言中，到期：{untilText(row.mutedUntil)}</Badge>;
}

const MUTE_OPTIONS: [string, string][] = [
  ['10m', '10 分钟'],
  ['1h', '1 小时'],
  ['1d', '1 天'],
  ['7d', '7 天'],
  ['30d', '30 天'],
  ['permanent', '永久'],
  ['custom', '自定义'],
];

export const MIN_CUSTOM_MINUTES = 1;
export const MAX_CUSTOM_MINUTES = 30 * 24 * 60;

/** 把禁言时长选项换成接口参数。自定义范围不对时返回 null。 */
export function muteDuration(choice: string, minutes: string): Record<string, unknown> | null {
  if (choice !== 'custom') return { duration: choice };
  const n = Number(minutes);
  if (!Number.isInteger(n) || n < MIN_CUSTOM_MINUTES || n > MAX_CUSTOM_MINUTES) return null;
  return { customSeconds: n * 60 };
}

/** 禁言：用户级（groupId 为空）或群内。不需要 step-up（PRD-admin 5.3 节）。 */
export function MuteDialog({
  userId,
  groupId,
  onDone,
  onClose,
}: {
  userId: string;
  groupId?: string;
  onDone: () => Promise<void> | void;
  onClose: () => void;
}) {
  const [choice, setChoice] = useState('1h');
  const [minutes, setMinutes] = useState('60');
  const duration = muteDuration(choice, minutes);
  return (
    <ConfirmDialog
      title={groupId ? '群内禁言' : '禁言'}
      needReason
      danger
      confirmLabel="禁言"
      onClose={onClose}
      onConfirm={async ({ reason, ticket }) => {
        if (!duration) throw new Error('invalid duration');
        await api('POST', '/console/api/mutes', {
          scope: groupId ? 'group' : 'user',
          userId,
          ...(groupId ? { groupId } : {}),
          ...duration,
          reason,
          ...(ticket ? { ticket } : {}),
        });
        await onDone();
      }}
    >
      <p>
        {groupId ? (
          <>
            <Text>{userId}</Text> 将不能在群 <Text>{groupId}</Text> 里发言。
          </>
        ) : (
          <>
            <Text>{userId}</Text> 将不能在任何会话里发消息，但可以登录、接收和查看历史。
          </>
        )}
      </p>
      <Field label="时长">
        {(id) => (
          <select id={id} value={choice} onChange={(e) => setChoice(e.target.value)}>
            {MUTE_OPTIONS.map(([v, label]) => (
              <option key={v} value={v}>
                {label}
              </option>
            ))}
          </select>
        )}
      </Field>
      {choice === 'custom' && (
        <Field
          label="自定义时长（分钟）"
          hint="1 分钟～30 天"
          error={duration ? null : '时长需要在 1 分钟到 30 天之间'}
        >
          {(id) => <input id={id} inputMode="numeric" value={minutes} onChange={(e) => setMinutes(e.target.value)} />}
        </Field>
      )}
    </ConfirmDialog>
  );
}

/** 解除禁言。 */
export function UnmuteDialog({
  userId,
  groupId,
  onDone,
  onClose,
}: {
  userId: string;
  groupId?: string;
  onDone: () => Promise<void> | void;
  onClose: () => void;
}) {
  return (
    <ConfirmDialog
      title="解除禁言"
      needReason
      confirmLabel="解除"
      onClose={onClose}
      onConfirm={async ({ reason, ticket }) => {
        await api('POST', '/console/api/mutes/release', {
          scope: groupId ? 'group' : 'user',
          userId,
          ...(groupId ? { groupId } : {}),
          reason,
          ...(ticket ? { ticket } : {}),
        });
        await onDone();
      }}
    >
      <p>
        解除 <Text>{userId}</Text> {groupId ? '在这个群里' : ''}的禁言。
      </p>
    </ConfirmDialog>
  );
}
