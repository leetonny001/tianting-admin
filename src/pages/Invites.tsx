import { useEffect, useState, type FormEvent } from 'react';
import { flushSync } from 'react-dom';
import { api } from '../api/client';
import { inviteErrorText, inviteResultUnknown } from '../api/errors';
import type { CreatedInvite, InviteRow } from '../api/types';
import { Badge, ConfirmDialog, CopyButton, Empty, ErrorNote, Field, Modal, Text } from '../components/ui';
import { formatTime } from '../lib/format';
import { useCursorList, usePolling } from '../lib/hooks';
import {
  checkInviteForm,
  defaultInviteForm,
  INVITE_BATCH_MAX,
  INVITE_MAX_USES_MAX,
  INVITE_NOTE_MAX,
  inviteCreator,
  inviteStatus,
  inviteStatusText,
  inviteStatusTone,
  type InviteForm,
} from '../lib/invites';

const INVITES_PATH = '/console/api/invites';

/**
 * 生成。结果未知时（5040 等）框直接关掉，由页面锁住"生成"：这时重新提交可能多出一批没人知道明文的邀请码。
 * 其他错误（4131、4000、5031）都是确定没有生成，留在框里可以改了再提交。
 */
function GenerateDialog({
  onCreated,
  onUnknown,
  onClose,
}: {
  onCreated: (invites: CreatedInvite[]) => void;
  onUnknown: (count: number) => void;
  onClose: () => void;
}) {
  const [form, setForm] = useState<InviteForm>(() => defaultInviteForm(Date.now()));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [openedAt] = useState(() => Date.now());
  const { errors, payload } = checkInviteForm(form, openedAt);
  const set = (patch: Partial<InviteForm>) => setForm((old) => ({ ...old, ...patch }));
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    // 到期时间可能在填表时过了，提交时再算一次。
    const now = checkInviteForm(form, Date.now()).payload;
    if (!now || busy) return;
    setBusy(true);
    setError(null);
    try {
      const r = await api<{ invites: CreatedInvite[] }>('POST', INVITES_PATH, now);
      onCreated(r.invites);
    } catch (err) {
      if (inviteResultUnknown(err)) {
        onUnknown(now.count);
        return;
      }
      setError(err);
      setBusy(false);
    }
  };
  return (
    <Modal title="生成邀请码" onClose={onClose}>
      <form onSubmit={submit}>
        <Field label="数量" hint={`一次最多 ${INVITE_BATCH_MAX} 个`} error={errors.count}>
          {(id) => (
            <input id={id} inputMode="numeric" value={form.count} onChange={(e) => set({ count: e.target.value })} />
          )}
        </Field>
        <Field
          label="每个可用次数"
          hint={`1～${INVITE_MAX_USES_MAX}。公开传播一个大额邀请码等于开放注册，次数够用就好。`}
          error={errors.maxUses}
        >
          {(id) => (
            <input
              id={id}
              inputMode="numeric"
              value={form.maxUses}
              onChange={(e) => set({ maxUses: e.target.value })}
            />
          )}
        </Field>
        <Field
          label="到期时间"
          // 输入框按本机时区，列表按北京时间：说清楚，不然两边差几个小时。
          hint={
            errors.expires
              ? '按本机时区填写'
              : `按本机时区填写，列表里显示为 ${formatTime(new Date(form.expires).getTime())}（北京时间）`
          }
          error={errors.expires}
        >
          {(id) => (
            <input
              id={id}
              type="datetime-local"
              value={form.expires}
              onChange={(e) => set({ expires: e.target.value })}
            />
          )}
        </Field>
        <Field label="备注（可选）" hint={`最多 ${INVITE_NOTE_MAX} 个字。不要把邀请码写在这里。`} error={errors.note}>
          {(id) => <textarea id={id} rows={2} value={form.note} onChange={(e) => set({ note: e.target.value })} />}
        </Field>
        {error !== null && (
          <p className="note note-error" role="alert">
            {inviteErrorText(error)}
          </p>
        )}
        <div className="modal-actions">
          <button type="button" className="btn" onClick={onClose}>
            取消
          </button>
          <button type="submit" className="btn btn-primary" disabled={!payload || busy}>
            {busy ? '处理中…' : '生成'}
          </button>
        </div>
      </form>
    </Modal>
  );
}

/** 明文只在这里显示，只存在这个页面的 React 状态里：不写存储、URL、日志，离开或刷新就没有了（F-ACC-09 规则 1）。 */
function CreatedPanel({ invites, onClose }: { invites: CreatedInvite[]; onClose: () => void }) {
  return (
    <section className="panel" aria-label="刚生成的邀请码">
      <h2>刚生成的邀请码（{invites.length} 个）</h2>
      <p className="note note-warn" role="alert">
        明文只显示这一次，离开或刷新页面后无法再查看，请现在复制保存。
      </p>
      <ul className="invite-codes">
        {invites.map((inv) => (
          <li key={inv.inviteId}>
            <Text className="mono invite-code">{inv.code}</Text>
            <span className="muted nowrap">
              可用 {inv.maxUses} 次，到期 {formatTime(inv.expiresAt)}
            </span>
            <CopyButton text={inv.code} />
          </li>
        ))}
      </ul>
      <div className="actions">
        {invites.length > 1 && <CopyButton text={invites.map((i) => i.code).join('\n')} label="复制全部" />}
        <button type="button" className="btn btn-small" onClick={onClose}>
          我已保存，关闭
        </button>
      </div>
    </section>
  );
}

export function InvitesPage() {
  const list = useCursorList<InviteRow>(
    (cursor) => `${INVITES_PATH}${cursor ? `?cursor=${encodeURIComponent(cursor)}` : ''}`,
    'invites',
    'invites',
  );
  const [generating, setGenerating] = useState(false);
  const [created, setCreated] = useState<CreatedInvite[] | null>(null);
  // 结果未知的那批数量。不为 null 时不能生成，要先按提示处理。
  const [unknownCount, setUnknownCount] = useState<number | null>(null);
  const [disabling, setDisabling] = useState<InviteRow | null>(null);
  // 整页离开（跳到别的站）后浏览器可能把页面原样留在往返缓存里，返回时明文还在。离开时就清掉。
  useEffect(() => {
    const clear = () => flushSync(() => setCreated(null));
    window.addEventListener('pagehide', clear);
    return () => window.removeEventListener('pagehide', clear);
  }, []);
  // 状态按这个时间算。到期的邀请码不用等刷新，30 秒内变成已过期。
  const [now, setNow] = useState(() => Date.now());
  usePolling(() => setNow(Date.now()), 30_000);
  return (
    <>
      <div className="page-head">
        <h1>邀请码</h1>
        <div className="actions">
          <button className="btn" type="button" disabled={list.loading} onClick={() => void list.reload()}>
            刷新
          </button>
          <button
            className="btn btn-primary"
            type="button"
            // 明文还在显示时不能生成：新结果会把没复制的明文顶掉。
            disabled={unknownCount !== null || created !== null}
            onClick={() => setGenerating(true)}
          >
            生成邀请码
          </button>
        </div>
      </div>
      {unknownCount !== null && (
        <div className="note note-warn" role="alert">
          <p>
            生成结果未知：这 {unknownCount}{' '}
            个邀请码可能已经生成，但明文无法再取回。请不要直接重复提交，先在下面的列表里核对， 停用最新的几条（最多{' '}
            {unknownCount} 条），再重新生成。
          </p>
          <button type="button" className="btn btn-small" onClick={() => setUnknownCount(null)}>
            已核对并停用，重新生成
          </button>
        </div>
      )}
      {created && <CreatedPanel invites={created} onClose={() => setCreated(null)} />}
      <ErrorNote error={list.error} />
      {list.loaded && list.items.length === 0 && <Empty>还没有邀请码</Empty>}
      {list.items.length > 0 && (
        <table>
          <thead>
            <tr>
              <th className="nowrap">后 4 位</th>
              <th className="nowrap">已用次数</th>
              <th>到期</th>
              <th>备注</th>
              <th>状态</th>
              <th>生成人</th>
              <th>生成时间</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {list.items.map((inv) => {
              const status = inviteStatus(inv, now);
              return (
                <tr key={inv.inviteId}>
                  <td className="mono nowrap">
                    <Text>{inv.codeLast4}</Text>
                  </td>
                  <td className="nowrap">
                    {inv.usedCount} / {inv.maxUses}
                  </td>
                  <td className="nowrap">{formatTime(inv.expiresAt)}</td>
                  <td>
                    <Text>{inv.note || '—'}</Text>
                  </td>
                  <td className="nowrap">
                    <Badge tone={inviteStatusTone[status]}>{inviteStatusText[status]}</Badge>
                  </td>
                  <td>
                    <Text>{inviteCreator(inv.createdBy)}</Text>
                  </td>
                  <td className="nowrap">{formatTime(inv.createdAt)}</td>
                  <td className="nowrap">
                    {status === 'active' && (
                      <button type="button" className="link" onClick={() => setDisabling(inv)}>
                        停用
                      </button>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
      {list.hasMore && (
        <button type="button" className="btn more" disabled={list.loading} onClick={() => void list.loadMore()}>
          加载更多
        </button>
      )}
      {generating && (
        <GenerateDialog
          onClose={() => setGenerating(false)}
          onCreated={(invites) => {
            setCreated(invites);
            setGenerating(false);
            void list.reload();
          }}
          onUnknown={(count) => {
            setUnknownCount(count);
            setGenerating(false);
            void list.reload();
          }}
        />
      )}
      {disabling && (
        <ConfirmDialog
          title="停用邀请码"
          danger
          confirmLabel="停用"
          onClose={() => setDisabling(null)}
          onConfirm={async () => {
            try {
              await api('POST', `${INVITES_PATH}/${encodeURIComponent(disabling.inviteId)}/disable`, {});
            } catch (err) {
              // 列表可能已经旧了（比如已被清除）：刷新一次，错误留在框里。
              void list.reload();
              throw err;
            }
            void list.reload();
          }}
        >
          <p>
            停用后缀为 <Text className="mono">{disabling.codeLast4}</Text>{' '}
            的邀请码，立即生效，之后不能重新启用。已经用它注册的账号不受影响。
          </p>
        </ConfirmDialog>
      )}
    </>
  );
}
