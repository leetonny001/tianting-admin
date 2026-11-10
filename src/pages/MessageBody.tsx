import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import { Link, useLocation } from 'react-router';
import { api, apiBlob, ApiError } from '../api/client';
import type { BodyMessage, BodyPage, Mentions, QuoteRef } from '../api/types';
import { ConfirmDialog, Empty, ErrorNote, Field, Modal, Text } from '../components/ui';
import { downloadName, saveBlob } from '../lib/download';
import { formatBytes, formatTime, reasonValid } from '../lib/format';
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

/**
 * 正文按纯文本。图片、文件（PRD-chat 第 14.1 节，FE-639）：文件名凭正文授权显示，文件内容不放开——
 * 只写"不可预览"，不请求、不内联渲染，后台 CSP 不放宽（R-CS-24）。文件名清空（过期）时显示"已过期"。
 */
export function bodyText(m: BodyMessage): string {
  const b = m.body;
  if (b?.text !== undefined) return b.text;
  if (m.type === 'file' && b?.file) {
    if (b.file.expired) return '[文件] 已过期';
    return `[文件] ${b.file.name || 'file'}，${formatBytes(b.file.size)}（不可预览）`;
  }
  if (m.type === 'image' && b?.image) {
    if (b.image.expired) return '[图片] 已过期';
    const dims = b.image.width && b.image.height ? `${b.image.width}×${b.image.height}，` : '';
    return `[图片] ${dims}${formatBytes(b.image.size)}（不可预览）`;
  }
  return b ? JSON.stringify(b) : '';
}

/**
 * 引用的摘要（PRD-chat F-QUO-02 规则 2、3）：normal 用服务端组装的 text；recalled、deleted、expired 没有原文。
 * 按纯文本显示，不做跳转。
 */
export function quoteText(q: QuoteRef): string {
  switch (q.state ?? 'normal') {
    case 'normal':
      return q.text ?? '';
    case 'recalled':
      return '引用内容已被撤回';
    case 'deleted':
      return '引用内容已被删除';
    case 'expired':
      return q.type === 'image' ? '[图片] 已过期' : '[文件] 已过期';
    default:
      return '引用内容不可用';
  }
}

/** 被 @ 的 userId 列表（F-MEN-01：提醒只看 mentions，不解析文本）；all 显示"所有人"。 */
export function mentionText(m: Mentions): string {
  const ids = [...new Set(m.userIds ?? [])];
  return [...(m.all ? ['所有人'] : []), ...ids].join('、');
}

/**
 * 可以经代理下载查看的附件（FE-671 第 3 条，AC-RCL-04-9）：只在隔离模式，只给撤回或后台删除的图片、文件，
 * 过期的没有。没有 fileId 的也没有。
 */
export function fetchable(
  m: BodyMessage,
  quarantine: boolean,
): { kind: 'image' | 'file'; fileId: string; name: (blobType: string) => string } | null {
  if (!quarantine || !(m.recalled || m.deleted)) return null;
  const kind = m.type === 'image' ? 'image' : m.type === 'file' ? 'file' : null;
  if (!kind) return null;
  const att = kind === 'image' ? m.body?.image : m.body?.file;
  if (!att?.fileId || att.expired) return null;
  const name = kind === 'file' ? m.body?.file?.name : undefined;
  // 图片的扩展名按类型：正文里没有 mime 时用代理响应的 Content-Type（console 用 im-server 记录的类型）。
  return { kind, fileId: att.fileId, name: (blobType) => downloadName(kind, m.seq, name, att.mime || blobType) };
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
  const [downloading, setDownloading] = useState('');
  const [dlError, setDlError] = useState<unknown>(null);
  // 没有授权（4039）时先弹授权框，授权后接着下载这一个。
  const pendingDownload = useRef<BodyMessage | null>(null);
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

  /**
   * 下载查看（CS-202）：POST，fileId 在路径里，会话和消息 ID 在请求体里；文件名不进 URL。
   * 字节进内存后交给浏览器另存（attachment），页面不内联渲染，CSP 不放宽。
   */
  const download = async (m: BodyMessage) => {
    const f = fetchable(m, quarantine);
    if (!f || downloading) return;
    setDownloading(m.msgId);
    setDlError(null);
    try {
      const blob = await apiBlob('POST', `/console/api/files/${encodeURIComponent(f.fileId)}/fetch`, {
        convId,
        msgId: m.msgId,
        variant: 'original',
      });
      saveBlob(blob, f.name(blob.type));
    } catch (err) {
      if (err instanceof ApiError && err.code === 4039) {
        pendingDownload.current = m;
        setNeedGrant(true);
      } else setDlError(err);
    } finally {
      setDownloading('');
    }
  };

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
      <ErrorNote error={dlError} />
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
                {m.recalled && !quarantine ? (
                  <p className="deleted">
                    该消息已被撤回（<Text>{m.recalledBy ?? ''}</Text>，{formatTime(m.recalledAt)}）
                  </p>
                ) : m.deleted && !quarantine ? (
                  <p className="deleted">
                    该消息已被删除（<Text>{m.deletedBy ?? ''}</Text>，{formatTime(m.deletedAt)}）
                  </p>
                ) : (
                  <>
                    {m.body?.quote && (
                      <p className="muted quote-line">
                        <Text>{`引用：${quoteText(m.body.quote)}`}</Text>
                      </p>
                    )}
                    <p className="body-text">
                      <Text>{bodyText(m)}</Text>
                    </p>
                    {m.body?.mentions && mentionText(m.body.mentions) && (
                      <p className="muted">
                        <Text>{`提及：${mentionText(m.body.mentions)}`}</Text>
                      </p>
                    )}
                  </>
                )}
                {m.recalled && quarantine && (
                  <p className="muted">
                    撤回人 <Text>{m.recalledBy ?? ''}</Text>，{formatTime(m.recalledAt)}
                  </p>
                )}
                {m.deleted && quarantine && (
                  <p className="muted">
                    删除人 <Text>{m.deletedBy ?? ''}</Text>，{formatTime(m.deletedAt)}
                  </p>
                )}
                {fetchable(m, quarantine) && (
                  <button
                    type="button"
                    className="btn btn-small"
                    disabled={downloading !== ''}
                    onClick={() => void download(m)}
                  >
                    {downloading === m.msgId ? '下载中…' : '下载查看'}
                  </button>
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
          onClose={() => {
            pendingDownload.current = null;
            setNeedGrant(false);
          }}
          onDone={async () => {
            setNeedGrant(false);
            const pending = pendingDownload.current;
            pendingDownload.current = null;
            setRows([]);
            await fetchPage();
            if (pending) await download(pending);
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
