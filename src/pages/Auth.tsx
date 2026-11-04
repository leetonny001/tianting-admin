import { useEffect, useState, type FormEvent } from 'react';
import { Link, Navigate, useNavigate, useSearchParams } from 'react-router';
import { api } from '../api/client';
import { signedOutText } from '../api/errors';
import type { SessionInfo } from '../api/types';
import { QrCode } from '../components/QrCode';
import { CopyButton, ErrorNote, Field } from '../components/ui';
import { useSession } from '../session';

function AuthShell({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="auth">
      <div className="auth-card">
        <div className="brand brand-auth">天听管理后台</div>
        <h1>{title}</h1>
        {children}
      </div>
    </div>
  );
}

export function LoginPage() {
  const { session, setSession } = useSession();
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const [useRecovery, setUseRecovery] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  if (session?.state === 'full') return <Navigate to="/" replace />;
  if (session?.state === 'setup') return <Navigate to="/setup" replace />;
  const notice = signedOutText(params.get('reason'));
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const s = await api<SessionInfo>(
        'POST',
        '/console/api/auth/login',
        {
          username: username.trim(),
          password,
          ...(useRecovery ? { recoveryCode: code.trim() } : { otp: code.trim() }),
        },
        { raw: true },
      );
      setSession(s);
      navigate(s.state === 'setup' ? '/setup' : '/', { replace: true });
    } catch (err) {
      setError(err);
      setPassword('');
      setCode('');
      setBusy(false);
    }
  };
  return (
    <AuthShell title="登录">
      {notice && !error && (
        <p className="note note-warn" role="status">
          {notice}
        </p>
      )}
      <form onSubmit={submit}>
        <Field label="账号">
          {(id) => (
            <input
              id={id}
              autoComplete="username"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              autoFocus
            />
          )}
        </Field>
        <Field label="密码">
          {(id) => (
            <input
              id={id}
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          )}
        </Field>
        <Field label={useRecovery ? '恢复码' : '动态码'}>
          {(id) => (
            <input
              id={id}
              autoComplete={useRecovery ? 'off' : 'one-time-code'}
              inputMode={useRecovery ? 'text' : 'numeric'}
              value={code}
              onChange={(e) => setCode(e.target.value)}
            />
          )}
        </Field>
        <ErrorNote error={error} />
        <button
          className="btn btn-primary btn-block"
          type="submit"
          disabled={busy || !username.trim() || !password || !code.trim()}
        >
          {busy ? '登录中…' : '登录'}
        </button>
      </form>
      <div className="auth-links">
        <button
          type="button"
          className="link"
          onClick={() => {
            setUseRecovery(!useRecovery);
            setCode('');
          }}
        >
          {useRecovery ? '用动态码登录' : '手机不在身边？用恢复码'}
        </button>
        <Link to="/activate">首次使用？激活账号</Link>
      </div>
    </AuthShell>
  );
}

export function ActivatePage() {
  const { setSession } = useSession();
  const navigate = useNavigate();
  const [username, setUsername] = useState('');
  const [code, setCode] = useState('');
  const [password, setPassword] = useState('');
  const [again, setAgain] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const mismatch = again !== '' && again !== password;
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const s = await api<SessionInfo>(
        'POST',
        '/console/api/auth/activate',
        { username: username.trim(), code: code.trim(), newPassword: password },
        { raw: true },
      );
      setSession(s);
      navigate('/setup', { replace: true });
    } catch (err) {
      setError(err);
      setBusy(false);
    }
  };
  return (
    <AuthShell title="激活账号">
      <form onSubmit={submit}>
        <Field label="账号">
          {(id) => (
            <input
              id={id}
              autoComplete="username"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              autoFocus
            />
          )}
        </Field>
        <Field label="激活码">
          {(id) => <input id={id} autoComplete="off" value={code} onChange={(e) => setCode(e.target.value)} />}
        </Field>
        <Field label="新密码" hint="至少 12 位，不能包含账号名，不能是常见密码">
          {(id) => (
            <input
              id={id}
              type="password"
              autoComplete="new-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          )}
        </Field>
        <Field label="再输一次" error={mismatch ? '两次输入不一致' : null}>
          {(id) => (
            <input
              id={id}
              type="password"
              autoComplete="new-password"
              value={again}
              onChange={(e) => setAgain(e.target.value)}
            />
          )}
        </Field>
        <ErrorNote error={error} />
        <button
          className="btn btn-primary btn-block"
          type="submit"
          disabled={busy || !username.trim() || !code.trim() || !password || password !== again}
        >
          激活
        </button>
      </form>
      <div className="auth-links">
        <Link to="/login">返回登录</Link>
      </div>
    </AuthShell>
  );
}

/** 恢复码只显示这一次。 */
export function RecoveryCodes({ codes, onDone }: { codes: string[]; onDone: () => void }) {
  const [saved, setSaved] = useState(false);
  return (
    <>
      <p className="note note-warn">恢复码只显示这一次。手机丢失时要靠它登录，请现在保存好。每个只能用一次。</p>
      <ul className="codes" aria-label="恢复码">
        {codes.map((c) => (
          <li key={c}>{c}</li>
        ))}
      </ul>
      <CopyButton text={codes.join('\n')} label="复制全部" />
      <label className="check">
        <input type="checkbox" checked={saved} onChange={(e) => setSaved(e.target.checked)} />
        我已保存
      </label>
      <button className="btn btn-primary btn-block" type="button" disabled={!saved} onClick={onDone}>
        完成
      </button>
    </>
  );
}

export function SetupPage() {
  const { session, setSession } = useSession();
  const navigate = useNavigate();
  const [uri, setUri] = useState('');
  const [otp, setOtp] = useState('');
  const [error, setError] = useState<unknown>(null);
  const [done, setDone] = useState<SessionInfo | null>(null);
  const [busy, setBusy] = useState(false);
  const ready = session?.state === 'setup';
  useEffect(() => {
    if (!ready || done) return;
    let live = true;
    api<{ otpauthUri: string }>('POST', '/console/api/auth/totp/setup', {})
      .then((r) => live && setUri(r.otpauthUri))
      .catch((err) => live && setError(err));
    return () => {
      live = false;
    };
    // done 变化不重新申请种子
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready]);
  if (session === undefined) return <p className="loading">加载中…</p>;
  if (session === null) return <Navigate to="/login" replace />;
  if (done) {
    return (
      <AuthShell title="保存恢复码">
        <RecoveryCodes
          codes={done.recoveryCodes ?? []}
          onDone={() => {
            setSession(done);
            navigate('/', { replace: true });
          }}
        />
      </AuthShell>
    );
  }
  if (session.state === 'full') return <Navigate to="/" replace />;
  const secret = uri ? new URL(uri).searchParams.get('secret') : '';
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      setDone(await api<SessionInfo>('POST', '/console/api/auth/totp/confirm', { otp: otp.trim() }));
    } catch (err) {
      setError(err);
      setOtp('');
    } finally {
      setBusy(false);
    }
  };
  return (
    <AuthShell title="绑定二次验证">
      <p>用验证器 App（如 Google Authenticator、1Password）扫描二维码，然后输入 6 位动态码。</p>
      {uri && <QrCode text={uri} label="二次验证二维码" />}
      {secret && (
        <p className="secret">
          无法扫码时手动输入：<code data-testid="totp-secret">{secret}</code>
        </p>
      )}
      <form onSubmit={submit}>
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
        <ErrorNote error={error} />
        <button className="btn btn-primary btn-block" type="submit" disabled={busy || !otp.trim() || !uri}>
          绑定
        </button>
      </form>
    </AuthShell>
  );
}
