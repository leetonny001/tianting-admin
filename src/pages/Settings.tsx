import { useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router';
import { api } from '../api/client';
import { ConfirmDialog, ErrorNote, Field, Modal } from '../components/ui';
import { useSession } from '../session';
import { RecoveryCodes } from './Auth';

function ChangePassword() {
  const [currentPassword, setCurrent] = useState('');
  const [otp, setOtp] = useState('');
  const [newPassword, setNew] = useState('');
  const [error, setError] = useState<unknown>(null);
  const [done, setDone] = useState(false);
  const [busy, setBusy] = useState(false);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setDone(false);
    try {
      await api('POST', '/console/api/me/password', { currentPassword, otp: otp.trim(), newPassword });
      setDone(true);
      setCurrent('');
      setNew('');
    } catch (err) {
      setError(err);
    } finally {
      setOtp('');
      setBusy(false);
    }
  };
  return (
    <form className="panel" onSubmit={submit}>
      <h2>修改密码</h2>
      <p>修改后，这个账号其他设备上的登录会失效。</p>
      <Field label="当前密码">
        {(id) => (
          <input
            id={id}
            type="password"
            autoComplete="current-password"
            value={currentPassword}
            onChange={(e) => setCurrent(e.target.value)}
          />
        )}
      </Field>
      <Field label="动态码">
        {(id) => (
          <input
            id={id}
            inputMode="numeric"
            autoComplete="one-time-code"
            value={otp}
            onChange={(e) => setOtp(e.target.value)}
          />
        )}
      </Field>
      <Field label="新密码" hint="至少 12 位，不能包含账号名，不能是常见密码，不能和最近用过的相同">
        {(id) => (
          <input
            id={id}
            type="password"
            autoComplete="new-password"
            value={newPassword}
            onChange={(e) => setNew(e.target.value)}
          />
        )}
      </Field>
      <ErrorNote error={error} />
      {done && <p className="note note-ok">密码已修改</p>}
      <button
        className="btn btn-primary"
        type="submit"
        disabled={busy || !currentPassword || !otp.trim() || !newPassword}
      >
        修改
      </button>
    </form>
  );
}

export function SettingsPage() {
  const { session, setSession, reload } = useSession();
  const navigate = useNavigate();
  const [confirming, setConfirming] = useState(false);
  const [codes, setCodes] = useState<string[] | null>(null);
  return (
    <>
      <h1>个人设置</h1>
      <ChangePassword />
      <section className="panel">
        <h2>恢复码</h2>
        <p>还剩 {session?.recoveryCodesLeft ?? '—'} 个。重新生成后，旧的恢复码全部作废。</p>
        <button className="btn" type="button" onClick={() => setConfirming(true)}>
          重新生成
        </button>
      </section>
      <section className="panel">
        <button
          className="btn"
          type="button"
          onClick={async () => {
            await api('POST', '/console/api/auth/logout', {}).catch(() => undefined);
            setSession(null);
            navigate('/login', { replace: true });
          }}
        >
          退出登录
        </button>
      </section>
      {confirming && (
        <ConfirmDialog
          title="重新生成恢复码"
          onClose={() => setConfirming(false)}
          onConfirm={async () => {
            const r = await api<{ recoveryCodes: string[] }>('POST', '/console/api/me/recovery-codes', {});
            setCodes(r.recoveryCodes);
          }}
        >
          旧的恢复码会立即作废。
        </ConfirmDialog>
      )}
      {codes && (
        <Modal title="新的恢复码" onClose={() => undefined}>
          <RecoveryCodes
            codes={codes}
            onDone={() => {
              setCodes(null);
              void reload();
            }}
          />
        </Modal>
      )}
    </>
  );
}
