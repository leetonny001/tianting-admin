import { useEffect, useState, type FormEvent } from 'react';
import { api } from '../api/client';
import type { AccountRow } from '../api/types';
import { Badge, ConfirmDialog, CopyButton, Empty, ErrorNote, Field, Modal, Text } from '../components/ui';
import { formatTime, reasonValid, roleNames } from '../lib/format';
import { useSession } from '../session';

const ALL_ROLES = ['super_admin', 'operator', 'support', 'moderator', 'auditor'];
const AUDITOR = 'auditor';

/** 角色多选。审计员不能和其他角色叠加：选中时其他项不可选（服务端 4093 兜底）。 */
function RolePicker({ value, onChange }: { value: string[]; onChange: (v: string[]) => void }) {
  const auditor = value.includes(AUDITOR);
  return (
    <fieldset className="roles">
      <legend>角色</legend>
      {ALL_ROLES.map((r) => (
        <label key={r} className="check">
          <input
            type="checkbox"
            checked={value.includes(r)}
            disabled={r === AUDITOR ? value.length > 0 && !auditor : auditor}
            onChange={(e) => onChange(e.target.checked ? [...value, r] : value.filter((x) => x !== r))}
          />
          {roleNames[r]}
        </label>
      ))}
    </fieldset>
  );
}

function ActivationCode({ username, code, onClose }: { username: string; code: string; onClose: () => void }) {
  return (
    <Modal title="激活码" onClose={onClose}>
      <p className="note note-warn">激活码只显示这一次，24 小时内有效。请用安全的方式发给本人。</p>
      <p>
        账号：<Text>{username}</Text>
      </p>
      <p className="codes-one">
        <code data-testid="activation-code">{code}</code> <CopyButton text={code} />
      </p>
      <div className="modal-actions">
        <button className="btn btn-primary" type="button" onClick={onClose}>
          我已记下
        </button>
      </div>
    </Modal>
  );
}

type Dialog =
  | { kind: 'create' }
  | { kind: 'roles'; account: AccountRow }
  | { kind: 'action'; account: AccountRow; action: 'disable' | 'enable' | 'reset' | 'unlock' }
  | { kind: 'code'; username: string; code: string }
  | null;

const actionText = {
  disable: { label: '停用', body: '停用后该账号的全部会话立即失效，不能再登录。', danger: true },
  enable: { label: '启用', body: '启用后账号可以再次登录。', danger: false },
  reset: { label: '重置', body: '重置会清除密码和二次验证，全部会话失效，并生成新的激活码。', danger: true },
  unlock: { label: '解锁', body: '清除登录失败计数，账号可以立即再次尝试登录。', danger: false },
};

function CreateDialog({ onClose, onCreated }: { onClose: () => void; onCreated: (u: string, c: string) => void }) {
  const [username, setUsername] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [roles, setRoles] = useState<string[]>([]);
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const r = await api<{ activationCode: string }>('POST', '/console/api/accounts', {
        username: username.trim(),
        displayName: displayName.trim(),
        roles,
      });
      onCreated(username.trim(), r.activationCode);
    } catch (err) {
      setError(err);
      setBusy(false);
    }
  };
  return (
    <Modal title="新建账号" onClose={onClose}>
      <form onSubmit={submit}>
        <Field label="账号名" hint="小写字母、数字、. _ -，3～32 位">
          {(id) => (
            <input
              id={id}
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              autoFocus
              autoComplete="off"
            />
          )}
        </Field>
        <Field label="显示名">
          {(id) => <input id={id} value={displayName} onChange={(e) => setDisplayName(e.target.value)} />}
        </Field>
        <RolePicker value={roles} onChange={setRoles} />
        <ErrorNote error={error} />
        <div className="modal-actions">
          <button type="button" className="btn" onClick={onClose}>
            取消
          </button>
          <button className="btn btn-primary" type="submit" disabled={busy || !username.trim() || roles.length === 0}>
            创建
          </button>
        </div>
      </form>
    </Modal>
  );
}

function RolesDialog({ account, onClose, onDone }: { account: AccountRow; onClose: () => void; onDone: () => void }) {
  const [roles, setRoles] = useState(account.roles);
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      await api('POST', `/console/api/accounts/${account.id}/roles`, { roles });
      onDone();
    } catch (err) {
      setError(err);
      setBusy(false);
    }
  };
  return (
    <Modal title={`修改 ${account.username} 的角色`} onClose={onClose}>
      <form onSubmit={submit}>
        <p className="modal-body">角色变化后，该账号需要重新登录。</p>
        <RolePicker value={roles} onChange={setRoles} />
        <ErrorNote error={error} />
        <div className="modal-actions">
          <button type="button" className="btn" onClick={onClose}>
            取消
          </button>
          <button className="btn btn-primary" type="submit" disabled={busy || roles.length === 0}>
            保存
          </button>
        </div>
      </form>
    </Modal>
  );
}

/** 应急授权（只有超管）：给自己临时加一个角色，到期时间以服务端返回为准。 */
function EmergencyGrant() {
  const [role, setRole] = useState('moderator');
  const [minutes, setMinutes] = useState('60');
  const [reason, setReason] = useState('');
  const [error, setError] = useState<unknown>(null);
  const [until, setUntil] = useState<number | null>(null);
  const [confirming, setConfirming] = useState(false);
  const { reload } = useSession();
  const m = Number(minutes);
  const ok = Number.isInteger(m) && m >= 15 && m <= 240 && reasonValid(reason);
  return (
    <section className="panel">
      <h2>应急授权</h2>
      <p>只能给自己，到期自动失效，并通知审计员和其他超管。</p>
      <div className="row">
        <Field label="角色">
          {(id) => (
            <select id={id} value={role} onChange={(e) => setRole(e.target.value)}>
              {ALL_ROLES.filter((r) => r !== AUDITOR && r !== 'super_admin').map((r) => (
                <option key={r} value={r}>
                  {roleNames[r]}
                </option>
              ))}
            </select>
          )}
        </Field>
        <Field label="时长（分钟）" hint="15～240">
          {(id) => (
            <input
              id={id}
              type="number"
              min={15}
              max={240}
              value={minutes}
              onChange={(e) => setMinutes(e.target.value)}
            />
          )}
        </Field>
        <Field label="理由">
          {(id) => <input id={id} value={reason} onChange={(e) => setReason(e.target.value)} />}
        </Field>
      </div>
      <ErrorNote error={error} />
      {until && <p className="note note-ok">已授权，到期时间：{formatTime(until)}</p>}
      <button className="btn" type="button" disabled={!ok} onClick={() => setConfirming(true)}>
        申请
      </button>
      {confirming && (
        <ConfirmDialog
          title="确认应急授权"
          onClose={() => setConfirming(false)}
          onConfirm={async () => {
            setError(null);
            const r = await api<{ expiresAt: number }>('POST', '/console/api/me/emergency-grants', {
              role,
              minutes: m,
              reason: reason.trim(),
            });
            setUntil(r.expiresAt);
            setReason('');
            await reload();
          }}
        >
          将给自己授予 {roleNames[role]} 角色 {m} 分钟。
        </ConfirmDialog>
      )}
    </section>
  );
}

export function AccountsPage() {
  const { session, can } = useSession();
  const [list, setList] = useState<AccountRow[]>([]);
  const [error, setError] = useState<unknown>(null);
  const [dialog, setDialog] = useState<Dialog>(null);
  const load = () => {
    api<{ accounts: AccountRow[] }>('GET', '/console/api/accounts?limit=100')
      .then((r) => setList(r.accounts))
      .catch(setError);
  };
  useEffect(load, []);
  const selfId = session?.account.id;
  return (
    <>
      <div className="page-head">
        <h1>账号管理</h1>
        <button className="btn btn-primary" type="button" onClick={() => setDialog({ kind: 'create' })}>
          新建账号
        </button>
      </div>
      <ErrorNote error={error} />
      <table>
        <thead>
          <tr>
            <th>账号</th>
            <th>显示名</th>
            <th>角色</th>
            <th>状态</th>
            <th>激活时间</th>
            <th>操作</th>
          </tr>
        </thead>
        <tbody>
          {list.map((a) => (
            <tr key={a.id}>
              <td>
                <Text>{a.username}</Text>
              </td>
              <td>
                <Text>{a.displayName}</Text>
              </td>
              <td>{a.roles.map((r) => roleNames[r] ?? r).join('、') || '—'}</td>
              <td>
                {a.status === 'active' ? (
                  <Badge tone="good">启用</Badge>
                ) : a.status === 'pending' ? (
                  <Badge>待激活</Badge>
                ) : (
                  <Badge tone="bad">已停用</Badge>
                )}
                {a.locked && <Badge tone="warn">已锁定</Badge>}
              </td>
              <td>{formatTime(a.activatedAt)}</td>
              <td className="actions">
                {a.id === selfId ? (
                  <span className="muted">自己的账号</span>
                ) : (
                  <>
                    <button type="button" className="link" onClick={() => setDialog({ kind: 'roles', account: a })}>
                      改角色
                    </button>
                    {a.status === 'disabled' ? (
                      <button
                        type="button"
                        className="link"
                        onClick={() => setDialog({ kind: 'action', account: a, action: 'enable' })}
                      >
                        启用
                      </button>
                    ) : (
                      <button
                        type="button"
                        className="link"
                        onClick={() => setDialog({ kind: 'action', account: a, action: 'disable' })}
                      >
                        停用
                      </button>
                    )}
                    <button
                      type="button"
                      className="link"
                      onClick={() => setDialog({ kind: 'action', account: a, action: 'reset' })}
                    >
                      重置
                    </button>
                  </>
                )}
                {a.locked && (
                  <button
                    type="button"
                    className="link"
                    onClick={() => setDialog({ kind: 'action', account: a, action: 'unlock' })}
                  >
                    解锁
                  </button>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {list.length === 0 && !error && <Empty>还没有账号</Empty>}
      {can('admin.emergency') && <EmergencyGrant />}
      {dialog?.kind === 'create' && (
        <CreateDialog
          onClose={() => setDialog(null)}
          onCreated={(username, code) => {
            setDialog({ kind: 'code', username, code });
            load();
          }}
        />
      )}
      {dialog?.kind === 'roles' && (
        <RolesDialog
          account={dialog.account}
          onClose={() => setDialog(null)}
          onDone={() => {
            setDialog(null);
            load();
          }}
        />
      )}
      {dialog?.kind === 'action' && (
        <ConfirmDialog
          title={`${actionText[dialog.action].label}账号 ${dialog.account.username}`}
          danger={actionText[dialog.action].danger}
          onClose={() => setDialog((d) => (d?.kind === 'code' ? d : null))}
          onConfirm={async () => {
            const { account, action } = dialog;
            const r = await api<{ activationCode?: string }>(
              'POST',
              `/console/api/accounts/${account.id}/${action}`,
              {},
            );
            load();
            if (r.activationCode) setDialog({ kind: 'code', username: account.username, code: r.activationCode });
          }}
        >
          {actionText[dialog.action].body}
        </ConfirmDialog>
      )}
      {dialog?.kind === 'code' && (
        <ActivationCode username={dialog.username} code={dialog.code} onClose={() => setDialog(null)} />
      )}
    </>
  );
}
