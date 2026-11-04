import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
  type ReactNode,
} from 'react';
import { useNavigate } from 'react-router';
import { api, ApiError, refreshSession, setHooks } from './api/client';
import type { SessionInfo } from './api/types';
import { Field, Modal } from './components/ui';

interface SessionContextValue {
  /** undefined：还在加载；null：没有登录。 */
  session: SessionInfo | null | undefined;
  setSession: (s: SessionInfo | null) => void;
  /** 被服务端退出登录的原因：路由守卫跳登录页时带上，不然提示就丢了。 */
  signedOutReason: string | null;
  can: (perm: string) => boolean;
  reload: () => Promise<void>;
}

const SessionContext = createContext<SessionContextValue | null>(null);

export function useSession() {
  const v = useContext(SessionContext);
  if (!v) throw new Error('useSession outside SessionProvider');
  return v;
}

/** step-up 框：错误码 4038 时弹出，验证后自动重放原请求。输错留在框内（AC-CON-07-6）。 */
function StepUpDialog({ onDone }: { onDone: (ok: boolean) => void }) {
  const [otp, setOtp] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      await api('POST', '/console/api/auth/step-up', { otp: otp.trim() }, { raw: true });
      onDone(true);
    } catch (err) {
      setBusy(false);
      setOtp('');
      setError(err instanceof ApiError && err.code === 4015 ? '动态码错误' : '验证失败，请重试');
    }
  };
  return (
    <Modal title="输入动态码确认" onClose={() => onDone(false)}>
      <form onSubmit={submit}>
        <p className="modal-body">这是敏感操作，请输入验证器里的 6 位动态码。验证后 5 分钟内不再询问。</p>
        <Field label="动态码" error={error || null}>
          {(id) => (
            <input
              id={id}
              inputMode="numeric"
              autoComplete="one-time-code"
              autoFocus
              value={otp}
              onChange={(e) => setOtp(e.target.value)}
            />
          )}
        </Field>
        <div className="modal-actions">
          <button type="button" className="btn" onClick={() => onDone(false)}>
            取消
          </button>
          <button type="submit" className="btn btn-primary" disabled={busy || !otp.trim()}>
            验证
          </button>
        </div>
      </form>
    </Modal>
  );
}

export function SessionProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<SessionInfo | null | undefined>(undefined);
  const [stepUp, setStepUp] = useState(false);
  const [signedOutReason, setSignedOutReason] = useState<string | null>(null);
  const pendingStepUp = useRef<((ok: boolean) => void) | null>(null);
  // useNavigate 的返回值每次跳转都会变：放进 ref，下面的 effect 只跑一次，不要每次跳转都重新取会话。
  const navigate = useNavigate();
  const navigateRef = useRef(navigate);
  useEffect(() => {
    navigateRef.current = navigate;
  });

  const reload = useCallback(async () => {
    try {
      setSession(await refreshSession<SessionInfo>());
    } catch (err) {
      if (!(err instanceof ApiError) || (err.code !== 4014 && err.code !== 4016)) throw err;
      if (err.reason && err.reason !== 'none') setSignedOutReason(err.reason); // 刷新页面时才发现过期：提示还要在
      setSession(null);
    }
  }, []);

  useEffect(() => {
    setHooks({
      onAuthRequired(reason) {
        // 不在这里跳转：setSession(null) 之后路由守卫会跳，两个跳转抢起来 reason 就丢了（AC-CON-05-12）。
        setSignedOutReason(reason);
        setSession(null);
      },
      onSetupRequired() {
        navigateRef.current('/setup', { replace: true });
      },
      requestStepUp() {
        return new Promise((resolve) => {
          pendingStepUp.current = resolve;
          setStepUp(true);
        });
      },
    });
    reload().catch(() => setSession(null));
    return () => setHooks(null);
  }, [reload]);

  const value = useMemo<SessionContextValue>(
    () => ({ session, setSession, signedOutReason, can: (p) => !!session?.perms.includes(p), reload }),
    [session, signedOutReason, reload],
  );
  return (
    <SessionContext.Provider value={value}>
      {children}
      {stepUp && (
        <StepUpDialog
          onDone={(ok) => {
            setStepUp(false);
            pendingStepUp.current?.(ok);
            pendingStepUp.current = null;
          }}
        />
      )}
    </SessionContext.Provider>
  );
}
