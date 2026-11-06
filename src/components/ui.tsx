import { useEffect, useId, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { ApiError, CANCELLED } from '../api/client';
import { errorText } from '../api/errors';
import { reasonValid } from '../lib/format';

/**
 * 用户可控内容（昵称、群名、理由、参数摘要）一律走这里：React 文本节点，不解析 HTML（F-CON-10 规则 2）。
 * 不用它的地方，只能是写死在代码里的文案。
 */
export function Text({ children, className }: { children: string | number | null | undefined; className?: string }) {
  return <span className={className}>{children ?? ''}</span>;
}

/** 头像只有首字母占位：不加载业务方的 URL，后台人员的 IP 和 UA 不会泄露给第三方（F-CON-10 规则 3）。 */
export function Avatar({ name }: { name: string }) {
  const first = [...name.trim()][0] ?? '?';
  const hue = [...name].reduce((n, c) => (n + c.codePointAt(0)!) % 6, 0);
  return (
    <span className={`avatar avatar-${hue}`} aria-hidden="true">
      {first.toUpperCase()}
    </span>
  );
}

export function Badge({
  tone = 'neutral',
  children,
}: {
  tone?: 'neutral' | 'good' | 'warn' | 'bad';
  children: ReactNode;
}) {
  return <span className={`badge badge-${tone}`}>{children}</span>;
}

export function ErrorNote({ error }: { error: unknown }) {
  if (!error) return null;
  if (error instanceof ApiError && error.code === CANCELLED) return null;
  return (
    <p className="note note-error" role="alert">
      {errorText(error)}
    </p>
  );
}

export function Empty({ children }: { children: ReactNode }) {
  return <p className="empty">{children}</p>;
}

/** 字段：label + 输入框 + 提示。 */
export function Field({
  label,
  hint,
  error,
  children,
}: {
  label: string;
  hint?: ReactNode;
  error?: string | null;
  children: (id: string) => ReactNode;
}) {
  const id = useId();
  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      {children(id)}
      {hint && <p className="field-hint">{hint}</p>}
      {error && (
        <p className="field-error" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}

/** 模态框。用原生 <dialog>：焦点圈定、Esc 关闭都是浏览器做的。 */
export function Modal({
  title,
  onClose,
  children,
  wide,
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
  wide?: boolean;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const d = ref.current;
    if (d && !d.open) d.showModal?.();
    return () => d?.close?.();
  }, []);
  return (
    <dialog
      ref={ref}
      className={wide ? 'modal modal-wide' : 'modal'}
      aria-label={title}
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
    >
      <h2>{title}</h2>
      {children}
    </dialog>
  );
}

export interface ConfirmValues {
  reason: string;
  ticket: string;
}

/**
 * 写操作的确认框（PRD-admin 5.3 节）：写清对象和影响；需要时填理由、手动输入确认文字。
 * 校验不过时"确认"不可点。服务端的错误显示在框内，不关闭。
 */
export function ConfirmDialog({
  title,
  children,
  needReason,
  confirmText,
  confirmLabel = '确认',
  danger,
  onConfirm,
  onClose,
}: {
  title: string;
  children: ReactNode;
  needReason?: boolean;
  confirmText?: string;
  confirmLabel?: string;
  danger?: boolean;
  onConfirm: (values: ConfirmValues) => Promise<void>;
  onClose: () => void;
}) {
  const [reason, setReason] = useState('');
  const [ticket, setTicket] = useState('');
  const [typed, setTyped] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const reasonOk = !needReason || reasonValid(reason);
  const typedOk = !confirmText || typed === confirmText;
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!reasonOk || !typedOk || busy) return;
    setBusy(true);
    setError(null);
    try {
      await onConfirm({ reason: reason.trim(), ticket: ticket.trim() });
      onClose();
    } catch (err) {
      setError(err);
      setBusy(false);
    }
  };
  return (
    <Modal title={title} onClose={onClose}>
      <form onSubmit={submit}>
        <div className="modal-body">{children}</div>
        {needReason && (
          <>
            <Field
              label="理由"
              hint="4～200 个字符"
              error={reason && !reasonOk ? '理由需要 4～200 个字符，不能由同一个字符重复组成' : null}
            >
              {(id) => (
                <textarea id={id} rows={2} value={reason} onChange={(e) => setReason(e.target.value)} autoFocus />
              )}
            </Field>
            <Field label="工单号（可选）">
              {(id) => <input id={id} value={ticket} onChange={(e) => setTicket(e.target.value)} />}
            </Field>
          </>
        )}
        {confirmText && (
          <Field label={`请输入 ${confirmText} 确认`}>
            {(id) => <input id={id} value={typed} onChange={(e) => setTyped(e.target.value)} autoComplete="off" />}
          </Field>
        )}
        <ErrorNote error={error} />
        <div className="modal-actions">
          <button type="button" className="btn" onClick={onClose}>
            取消
          </button>
          <button
            type="submit"
            className={danger ? 'btn btn-danger' : 'btn btn-primary'}
            disabled={!reasonOk || !typedOk || busy}
          >
            {busy ? '处理中…' : confirmLabel}
          </button>
        </div>
      </form>
    </Modal>
  );
}

/** 复制按钮。 */
export function CopyButton({ text, label = '复制' }: { text: string; label?: string }) {
  const [state, setState] = useState<'idle' | 'done' | 'failed'>('idle');
  return (
    <button
      type="button"
      className="btn btn-small"
      onClick={() => {
        const written = navigator.clipboard?.writeText(text) ?? Promise.reject(new Error('no clipboard'));
        written.then(
          () => setState('done'),
          () => setState('failed'),
        );
      }}
    >
      {state === 'done' ? '已复制' : state === 'failed' ? '复制失败，请手动选择' : label}
    </button>
  );
}
