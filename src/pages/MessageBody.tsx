import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import { Link, useLocation } from 'react-router';
import { api, ApiError } from '../api/client';
import type { BodyMessage, BodyPage } from '../api/types';
import { ConfirmDialog, Empty, ErrorNote, Field, Modal, Text } from '../components/ui';
import { formatTime, reasonValid } from '../lib/format';
import { useSession } from '../session';

const MAX_DELETE = 50;

/** 水印：账号名 + 当前时间到分钟 + 授权 ID 前 8 位。用于追溯，不作为防泄露手段（F-ADM-08 规则 6）。 */
export function watermarkText(username: string, nowMs: number, grantPrefix: string): string {
  const d = new Date(nowMs);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${username} ${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())} ${grantPrefix}`;
}

const TILES = Array.from({ length: 60 }, (_, i) => i);

function Watermark({ username, grantPrefix }: { username: string; grantPrefix: string }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 60_000);
    return () => clearInterval(t);
  }, []);
  const text = watermarkText(username, now, grantPrefix);
  return (
    <div className="watermark" data-testid="watermark" aria-hidden="true">
      {TILES.map((i) => (
        <span key={i}>{text}</span>
      ))}
    </div>
  );
}

/** 工单号 + 理由 + 当次动态码。step-up 窗口不算数，每次都要输入（F-CON-07 规则 3）。 */
function GrantDialog({
  convId,
  quarantine,
  onDone,
  onClose,
}: {
  convId: string;
  quarantine: boolean;
  onDone: () => Promise<void>;
  onClose: () => void;
}) {
  const [ticket, setTicket] = useState('');
  const [reason, setReason] = useState('');
  const [otp, setOtp] = useState('');
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const ready = ticket.trim() !== '' && reasonValid(reason) && /^\d{6}$/.test(otp);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!ready || busy) return;
    setBusy(true);
    setError(null);
    try {
      await api('POST', '/console/api/messages/grants', {
        convId,
        ticket: ticket.trim(),
        reason: reason.trim(),
        otp,
        ...(quarantine ? { quarantine: true } : {}),
      });
      await onDone();
      onClose();
    } catch (err) {
      setError(err);
      setOtp('');
      setBusy(false);
    }
  };
  return (
    <Modal title={quarantine ? '查看隔离原文' : '查看消息正文'} onClose={onClose}>
      <form onSubmit={submit}>
        <div className="modal-body">
          <p>
            查看 <Text>{convId}</Text> 的{quarantine ? '隔离原文' : '正文'}会写审计，授权 15
            分钟内有效，每天有次数上限。
          </p>
        </div>
        <Field label="工单号">
          {(id) => <input id={id} value={ticket} onChange={(e) => setTicket(e.target.value)} autoFocus />}
        </Field>
        <Field
          label="理由"
          hint="4～200 个字符"
          error={reason && !reasonValid(reason) ? '理由需要 4～200 个字符，不能由同一个字符重复组成' : null}
        >
          {(id) => <textarea id={id} rows={2} value={reason} onChange={(e) => setReason(e.target.value)} />}
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
        <ErrorNote error={error} />
        <div className="modal-actions">
          <button type="button" className="btn" onClick={onClose}>
            取消
          </button>
          <button type="submit" className="btn btn-primary" disabled={!ready || busy}>
            {busy ? '处理中…' : '查看'}
          </button>
        </div>
      </form>
    </Modal>
  );
}

function bodyText(m: BodyMessage): string {
  if (m.body?.text !== undefined) return m.body.text;
  return m.body ? JSON.stringify(m.body) : '';
}

/** 正文按纯文本显示（Text 组件），没有导出、复制按钮（F-ADM-08 规则 7）。 */
export function MessageBodyPage() {
  const location = useLocation();
  const state = (location.state as { convId?: string; quarantine?: boolean } | null) ?? {};
  // 会话 ID 不进 URL：不进浏览器历史和访问日志。
  const convId = state.convId ?? '';
  const quarantine = !!state.quarantine;
  const { session, can } = useSession();
  const [rows, setRows] = useState<BodyMessage[]>([]);
  const [hasMore, setHasMore] = useState(false);
  const [grantPrefix, setGrantPrefix] = useState('');
  const [needGrant, setNeedGrant] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [deleting, setDeleting] = useState(false);
  const [notice, setNotice] = useState('');
  const started = useRef(false);

  const fetchPage = useCallback(
    async (beforeSeq?: number) => {
      setBusy(true);
      setError(null);
      try {
        const page = await api<BodyPage>('POST', '/console/api/messages/body', {
          convId,
          ...(quarantine ? { quarantine: true } : {}),
          ...(beforeSeq ? { beforeSeq } : {}),
        });
        setGrantPrefix(page.grantPrefix);
        // seq 倒序显示：最新的在最上面。
        const sorted = [...page.messages].sort((a, b) => b.seq - a.seq);
        setRows((old) => (beforeSeq ? [...old, ...sorted] : sorted));
        setHasMore(page.hasMore);
      } catch (err) {
        // 4039 弹同一个框，不跳登录页（AC-ADM-08-5）。
        if (err instanceof ApiError && err.code === 4039) setNeedGrant(true);
        else setError(err);
      } finally {
        setBusy(false);
      }
    },
    [convId, quarantine],
  );
  useEffect(() => {
    if (convId && !started.current) {
      started.current = true;
      void fetchPage();
    }
  }, [convId, fetchPage]);

  if (!convId) {
    return (
      <>
        <h1>消息正文</h1>
        <Empty>
          请从<Link to="/messages">消息元数据</Link>页进入
        </Empty>
      </>
    );
  }
  const canDelete = !quarantine && can('msg.delete');
  const toggle = (id: string) => {
    setSelected((old) => {
      const next = new Set(old);
      if (next.has(id)) next.delete(id);
      else if (next.size < MAX_DELETE) next.add(id);
      return next;
    });
  };
  const c2cDisabled = error instanceof ApiError && error.reason === 'c2cBodyDisabled';
  return (
    <>
      <div className="page-head">
        <h1>
          {quarantine ? '隔离原文' : '消息正文'}：<Text>{convId}</Text>
        </h1>
        {canDelete && (
          <div className="actions">
            <button
              className="btn btn-danger"
              type="button"
              disabled={selected.size === 0}
              onClick={() => setDeleting(true)}
            >
              删除所选（{selected.size}）
            </button>
          </div>
        )}
      </div>
      {notice && (
        <p className="note note-ok" role="status">
          {notice}
        </p>
      )}
      {c2cDisabled ? <p className="note note-warn">单聊正文查看未开启</p> : <ErrorNote error={error} />}
      <section className="body-area">
        {grantPrefix && <Watermark username={session?.account.username ?? ''} grantPrefix={grantPrefix} />}
        {rows.length === 0 && !busy && !needGrant && !error && <Empty>没有消息</Empty>}
        {rows.map((m) => {
          const selectable = canDelete && !m.deleted && m.type !== 'tip';
          return (
            <article className="body-row" key={m.seq}>
              {canDelete && (
                <input
                  type="checkbox"
                  aria-label={`选择第 ${m.seq} 条`}
                  disabled={!selectable}
                  checked={selected.has(m.msgId)}
                  onChange={() => toggle(m.msgId)}
                />
              )}
              <div>
                <p className="muted">
                  #{m.seq} <Text>{m.from}</Text> {formatTime(m.ts)}
                </p>
                {m.deleted && !quarantine ? (
                  <p className="deleted">
                    该消息已被删除（<Text>{m.deletedBy ?? ''}</Text>，{formatTime(m.deletedAt)}）
                  </p>
                ) : (
                  <p className="body-text">
                    <Text>{bodyText(m)}</Text>
                  </p>
                )}
                {m.deleted && quarantine && (
                  <p className="muted">
                    删除人 <Text>{m.deletedBy ?? ''}</Text>，{formatTime(m.deletedAt)}
                  </p>
                )}
              </div>
            </article>
          );
        })}
      </section>
      {hasMore && (
        <button
          type="button"
          className="btn more"
          disabled={busy}
          onClick={() => void fetchPage(rows[rows.length - 1]?.seq)}
        >
          加载更早的
        </button>
      )}
      {needGrant && (
        <GrantDialog
          convId={convId}
          quarantine={quarantine}
          onClose={() => setNeedGrant(false)}
          onDone={async () => {
            setNeedGrant(false);
            setRows([]);
            await fetchPage();
          }}
        />
      )}
      {deleting && (
        <ConfirmDialog
          title="删除消息"
          needReason
          danger
          confirmLabel="删除"
          onClose={() => setDeleting(false)}
          onConfirm={async ({ reason, ticket }) => {
            await api('POST', '/console/api/messages/delete', {
              convId,
              msgIds: [...selected],
              reason,
              ...(ticket ? { ticket } : {}),
            });
            setNotice(`已删除 ${selected.size} 条，不再显示`);
            setSelected(new Set());
            await fetchPage();
          }}
        >
          <p>
            将删除选中的 {selected.size}{' '}
            条消息。用户那边显示"该消息已被删除"；已经展示的系统推送通知无法撤回，原文加密保存 30 天。
          </p>
        </ConfirmDialog>
      )}
    </>
  );
}
