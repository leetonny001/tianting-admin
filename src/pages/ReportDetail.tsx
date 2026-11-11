import { useCallback, useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { Link, useLocation, useParams } from 'react-router';
import { api, apiBlob, ApiError } from '../api/client';
import type { Evidence, EvidenceMessage, ReportDetail } from '../api/types';
import { ConfirmDialog, Empty, ErrorNote, Field, Modal, Text } from '../components/ui';
import { downloadName, saveBlob } from '../lib/download';
import { formatBytes, formatTime, messageTypeLabel, reasonValid } from '../lib/format';
import { dataUrl, inlineImage, reasonLabel, stateLabel, targetText } from '../lib/moderation';
import { useSession } from '../session';
import { mentionText, quoteText, Watermark } from './MessageBody';

const base = (id: string) => `/console/api/reports/${encodeURIComponent(id)}`;

const isGrantNeeded = (err: unknown) => err instanceof ApiError && err.code === 4039;
const isC2cOff = (err: unknown) => err instanceof ApiError && err.reason === 'c2cBodyDisabled';
/** 单聊消息举报没带理由：console 400 / 4000 reasonInvalid（CS-207）。直接打开链接、不知道是不是单聊时靠它补问理由。 */
const needsReason = (err: unknown) => err instanceof ApiError && err.code === 4000 && err.reason === 'reasonInvalid';

/** 元数据里一条消息的大小：图片、文件是原文件字节数，其他是正文长度（同元数据页）。 */
function metaSizeText(m: { type?: string; bodyLength?: number; fileSize?: number }): string {
  if ((m.type === 'image' || m.type === 'file') && typeof m.fileSize === 'number') return formatBytes(m.fileSize);
  return typeof m.bodyLength === 'number' ? String(m.bodyLength) : '—';
}

/** 证据里的正文：按纯文本显示（Text）。文件名凭证据授权显示，含 <script> 也只是文字（AC-MOD-04-15）。 */
export function evidenceText(m: EvidenceMessage): string {
  const b = m.body;
  if (b?.text !== undefined) return b.text;
  if (m.type === 'file' && b?.file) {
    if (b.file.expired) return '[文件] 已过期';
    return `[文件] ${b.file.name || 'file'}，${formatBytes(b.file.size)}`;
  }
  if (m.type === 'image' && b?.image) {
    if (b.image.expired) return '[图片] 已过期';
    const dims = b.image.width && b.image.height ? `${b.image.width}×${b.image.height}，` : '';
    return `[图片] ${dims}${formatBytes(b.image.size)}`;
  }
  return b ? JSON.stringify(b) : '';
}

/** 证据授权（F-MOD-04 规则 3）：理由 + 当次动态码，工单号自动用举报 ID、不能改。step-up 窗口不算数。 */
function EvidenceGrantDialog({
  reportId,
  onDone,
  onC2cOff,
  onClose,
}: {
  reportId: string;
  onDone: () => Promise<void>;
  onC2cOff: () => void;
  onClose: () => void;
}) {
  const [reason, setReason] = useState('');
  const [otp, setOtp] = useState('');
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const ready = reasonValid(reason) && /^\d{6}$/.test(otp);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!ready || busy) return;
    setBusy(true);
    setError(null);
    try {
      await api('POST', `${base(reportId)}/evidence-grant`, { reason: reason.trim(), otp });
      onClose();
      await onDone();
    } catch (err) {
      if (isC2cOff(err)) {
        onClose();
        onC2cOff();
        return;
      }
      setError(err);
      setOtp('');
      setBusy(false);
    }
  };
  return (
    <Modal title="查看举报证据" onClose={onClose}>
      <form onSubmit={submit}>
        <div className="modal-body">
          <p>查看证据会写审计，授权 15 分钟内有效，每天有次数上限。</p>
        </div>
        <Field label="工单号" hint="自动使用举报 ID">
          {(id) => <input id={id} value={reportId} readOnly />}
        </Field>
        <Field
          label="理由"
          hint="4～200 个字符"
          error={reason && !reasonValid(reason) ? '理由需要 4～200 个字符，不能由同一个字符重复组成' : null}
        >
          {(id) => <textarea id={id} rows={2} value={reason} onChange={(e) => setReason(e.target.value)} autoFocus />}
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

type Shot = { url?: string; blob?: Blob; error?: unknown };

/**
 * 证据图片（R-CS-12，AC-MOD-04-12）：缩略图和原图都经 console 同源取（POST），字节转成 data: 地址显示——
 * 后台 CSP 的 img-src 是 'self' data:，不加 blob:（console-chat 第 29 条）。console 没按图片返回的（伪造的图片）只给下载。
 */
function EvidenceImage({
  reportId,
  m,
  fileId,
  onNeedGrant,
}: {
  reportId: string;
  m: EvidenceMessage;
  fileId: string;
  onNeedGrant: () => void;
}) {
  const [shots, setShots] = useState<Record<string, Shot>>({});
  const started = useRef(false);
  const needGrant = useRef(onNeedGrant);
  useEffect(() => {
    needGrant.current = onNeedGrant;
  });
  useEffect(() => {
    if (started.current) return;
    started.current = true;
    for (const variant of ['thumb', 'original']) {
      void (async () => {
        try {
          const blob = await apiBlob('POST', `${base(reportId)}/files/${encodeURIComponent(fileId)}/fetch`, {
            msgId: m.msgId,
            variant,
          });
          const shot: Shot = inlineImage(blob.type) ? { url: await dataUrl(blob) } : { blob };
          setShots((old) => ({ ...old, [variant]: shot }));
        } catch (err) {
          if (isGrantNeeded(err)) needGrant.current();
          else setShots((old) => ({ ...old, [variant]: { error: err } }));
        }
      })();
    }
  }, [reportId, fileId, m.msgId]);
  return (
    <div className="evidence-images">
      {(
        [
          ['thumb', '缩略图'],
          ['original', '原图'],
        ] as const
      ).map(([variant, label]) => {
        const s = shots[variant];
        return (
          <figure key={variant}>
            {s?.url && <img src={s.url} alt={label} />}
            {s?.blob && (
              <button
                type="button"
                className="btn btn-small"
                onClick={() => saveBlob(s.blob!, downloadName('image', m.seq, undefined, m.body?.image?.mime))}
              >
                下载
              </button>
            )}
            {s?.error !== undefined && <ErrorNote error={s.error} />}
            {!s && <span className="muted">加载中…</span>}
            <figcaption>{label}</figcaption>
          </figure>
        );
      })}
    </div>
  );
}

/** 证据里的一条消息。只存了元数据的（单聊开关关闭期间、隔离原文过期、消息已物理删除）没有正文。 */
function EvidenceRow({ reportId, m, onNeedGrant }: { reportId: string; m: EvidenceMessage; onNeedGrant: () => void }) {
  const [downloading, setDownloading] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const image = m.type === 'image' ? m.body?.image : undefined;
  const file = m.type === 'file' ? m.body?.file : undefined;
  // 其他文件（含 html）只有下载：console 回 attachment，页面不内联渲染（AC-MOD-04-12）。
  const download = async () => {
    if (!file?.fileId || downloading) return;
    setDownloading(true);
    setError(null);
    try {
      const blob = await apiBlob('POST', `${base(reportId)}/files/${encodeURIComponent(file.fileId)}/fetch`, {
        msgId: m.msgId,
        variant: 'original',
      });
      saveBlob(blob, downloadName('file', m.seq, file.name, file.mime || blob.type));
    } catch (err) {
      if (isGrantNeeded(err)) onNeedGrant();
      else setError(err);
    } finally {
      setDownloading(false);
    }
  };
  return (
    <article className="body-row">
      <div>
        <p className="muted">
          #{m.seq} <Text>{m.from}</Text> {formatTime(m.ts)} {messageTypeLabel(m.type)}
        </p>
        {m.recalled && (
          <p className="muted">
            已撤回（<Text>{m.recalledBy ?? ''}</Text>，{formatTime(m.recalledAt)}），以下是隔离原文
          </p>
        )}
        {!m.body ? (
          <p className="deleted">没有正文，只有元数据</p>
        ) : (
          <>
            {m.body.quote && (
              <p className="muted quote-line">
                <Text>{`引用：${quoteText(m.body.quote)}`}</Text>
              </p>
            )}
            <p className="body-text">
              <Text>{evidenceText(m)}</Text>
            </p>
            {m.body.mentions && mentionText(m.body.mentions) && (
              <p className="muted">
                <Text>{`提及：${mentionText(m.body.mentions)}`}</Text>
              </p>
            )}
            {image?.fileId && !image.expired && (
              <EvidenceImage reportId={reportId} m={m} fileId={image.fileId} onNeedGrant={onNeedGrant} />
            )}
            {file?.fileId && !file.expired && (
              <button type="button" className="btn btn-small" disabled={downloading} onClick={() => void download()}>
                {downloading ? '下载中…' : '下载'}
              </button>
            )}
            <ErrorNote error={error} />
          </>
        )}
      </div>
    </article>
  );
}

/** 证据（FE-697 第 3 条）：先读，没有授权（4039）弹授权框；任何证据请求 4039 都弹同一个框。 */
function EvidenceSection({ reportId }: { reportId: string }) {
  const { session } = useSession();
  const [evidence, setEvidence] = useState<Evidence | null>(null);
  const [gen, setGen] = useState(0);
  const [asking, setAsking] = useState(false);
  const [c2cOff, setC2cOff] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const read = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      const ev = await api<Evidence>('POST', `${base(reportId)}/evidence`, {});
      setEvidence(ev);
      setGen((g) => g + 1);
    } catch (err) {
      if (isGrantNeeded(err)) setAsking(true);
      else if (isC2cOff(err)) setC2cOff(true);
      else setError(err);
    } finally {
      setBusy(false);
    }
  }, [reportId]);
  const needGrant = useCallback(() => setAsking(true), []);
  return (
    <section className="panel">
      <h2>证据</h2>
      {c2cOff ? (
        // 单聊（P-48 ①：单聊消息举报、用户举报按单聊对待）：开关关闭时只能看元数据和被举报次数（F-MOD-04 规则 4）。
        <p className="note note-warn">单聊正文查看未开启</p>
      ) : (
        !evidence && (
          <button type="button" className="btn" disabled={busy} onClick={() => void read()}>
            查看证据
          </button>
        )
      )}
      <ErrorNote error={error} />
      {evidence && !c2cOff && (
        <div className="body-area" key={gen}>
          <Watermark username={session?.account.username ?? ''} grantPrefix={evidence.grantPrefix} />
          {evidence.undecryptable && (
            <p className="note note-warn" role="alert">
              证据无法解密
            </p>
          )}
          {evidence.note !== undefined && (
            <p className="body-text">
              <Text>{`补充说明：${evidence.note}`}</Text>
            </p>
          )}
          {evidence.messages.length === 0 && !evidence.undecryptable && <Empty>证据里没有消息</Empty>}
          {evidence.messages.map((m) => (
            <EvidenceRow key={m.msgId} reportId={reportId} m={m} onNeedGrant={needGrant} />
          ))}
        </div>
      )}
      {asking && (
        <EvidenceGrantDialog
          reportId={reportId}
          onClose={() => setAsking(false)}
          onC2cOff={() => setC2cOff(true)}
          onDone={read}
        />
      )}
    </section>
  );
}

/** 跳转到已有操作（F-MOD-04 规则 5）：只是链接，不自动执行；各自走现有的权限、确认和审计。 */
function ActionLinks({ d }: { d: ReportDetail }) {
  const { can } = useSession();
  const user = d.targetUser;
  const groupId = d.groupId ?? (d.convId?.startsWith('group:') ? d.convId.slice('group:'.length) : undefined);
  const links: { key: string; node: ReactNode }[] = [];
  if (d.targetType === 'message' && d.convId && can('msg.delete'))
    links.push({
      key: 'delete',
      node: (
        <Link to="/messages/body" state={{ convId: d.convId }}>
          删除消息
        </Link>
      ),
    });
  if (user && can('mute.write'))
    links.push({ key: 'mute', node: <Link to={`/users/${encodeURIComponent(user)}`}>禁言</Link> });
  if (user && can('user.ban'))
    links.push({ key: 'ban', node: <Link to={`/users/${encodeURIComponent(user)}`}>封禁</Link> });
  if (user && can('user.kick'))
    links.push({ key: 'kick', node: <Link to={`/users/${encodeURIComponent(user)}`}>强制下线</Link> });
  if (groupId && can('group.dissolve'))
    links.push({ key: 'dissolve', node: <Link to={`/groups/${encodeURIComponent(groupId)}`}>解散群</Link> });
  if (links.length === 0) return null;
  return (
    <section className="panel">
      <h2>处置</h2>
      <p className="muted">跳转到对应页面操作，不会自动执行。</p>
      <ul className="actions" aria-label="处置">
        {links.map((l) => (
          <li key={l.key}>{l.node}</li>
        ))}
      </ul>
    </section>
  );
}

/**
 * 举报单（FE-697，PRD-chat F-MOD-04 规则 2～5）：打开是 POST .../view（每次写审计 report.view）；
 * 单聊消息举报要先填理由，和单聊元数据查询共用每天 50 个会话（超出 4292）。元数据里没有 note 和文件名（要证据授权）。
 */
export function ReportDetailPage() {
  const { id = '' } = useParams();
  const location = useLocation();
  const c2cHint = !!(location.state as { c2c?: boolean } | null)?.c2c;
  const { can } = useSession();
  const [detail, setDetail] = useState<ReportDetail | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [asking, setAsking] = useState(false);
  const [resolving, setResolving] = useState<'handled' | 'rejected' | null>(null);
  const [notice, setNotice] = useState('');
  // 刷新（4098）时用打开时填的理由，不再问一次。
  const viewArgs = useRef<Record<string, string>>({});
  const started = useRef(false);

  const view = useCallback(
    async (args: Record<string, string>) => {
      const d = await api<ReportDetail>('POST', `${base(id)}/view`, args);
      viewArgs.current = args;
      setError(null);
      setDetail(d);
    },
    [id],
  );
  useEffect(() => {
    if (started.current) return;
    started.current = true;
    if (c2cHint) setAsking(true);
    else
      void view({}).catch((err) => {
        if (needsReason(err)) setAsking(true);
        else setError(err);
      });
  }, [c2cHint, view]);

  return (
    <>
      <div className="page-head">
        <h1>
          举报单 <Text className="mono">{id}</Text>
        </h1>
        <div className="actions">
          <Link to="/reports">返回队列</Link>
        </div>
      </div>
      {notice && (
        <p className="note note-ok" role="status">
          {notice}
        </p>
      )}
      <ErrorNote error={error} />
      {!detail && !asking && !error && c2cHint && (
        <Empty>
          单聊举报要填写理由才能查看。
          <button type="button" className="btn btn-small" onClick={() => setAsking(true)}>
            填写理由
          </button>
        </Empty>
      )}
      {detail && (
        <>
          <section className="panel">
            <dl className="kv">
              <dt>举报对象</dt>
              <dd>
                <Text>{targetText(detail)}</Text>
              </dd>
              <dt>举报人</dt>
              <dd>
                <Text>{detail.reporter}</Text>
              </dd>
              {detail.targetUser && (
                <>
                  <dt>被举报人</dt>
                  <dd>
                    <Text>{detail.targetUser}</Text>
                  </dd>
                </>
              )}
              {typeof detail.targetReportCount === 'number' && (
                <>
                  <dt>该用户被举报的总次数</dt>
                  <dd>{detail.targetReportCount} 次</dd>
                </>
              )}
              <dt>时间</dt>
              <dd>{formatTime(detail.createdAt)}</dd>
              <dt>理由</dt>
              <dd>{reasonLabel(detail.reason)}</dd>
              <dt>状态</dt>
              <dd>{stateLabel(detail.state)}</dd>
              {detail.state !== 'pending' && (
                <>
                  <dt>处理人</dt>
                  <dd>
                    <Text>{detail.handledBy ?? ''}</Text>
                  </dd>
                  <dt>处理时间</dt>
                  <dd>{formatTime(detail.handledAt)}</dd>
                  <dt>结论</dt>
                  <dd className="body-text">
                    <Text>{detail.conclusion ?? ''}</Text>
                  </dd>
                </>
              )}
            </dl>
            {detail.messages && detail.messages.length > 0 && (
              <table aria-label="被举报的消息">
                <thead>
                  <tr>
                    <th>msgId</th>
                    <th>发送者</th>
                    <th>类型</th>
                    <th>大小</th>
                  </tr>
                </thead>
                <tbody>
                  {detail.messages.map((m) => (
                    <tr key={m.msgId}>
                      <td className="mono">
                        <Text>{m.msgId}</Text>
                      </td>
                      <td>
                        <Text>{m.from ?? ''}</Text>
                      </td>
                      <td>
                        <Text>{m.type ? messageTypeLabel(m.type) : '—'}</Text>
                      </td>
                      <td className="nowrap">{metaSizeText(m)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </section>
          {can('report.evidence') && <EvidenceSection reportId={id} />}
          {can('report.handle') && detail.state === 'pending' && (
            <section className="panel">
              <h2>结案</h2>
              <div className="actions">
                <button type="button" className="btn btn-primary" onClick={() => setResolving('handled')}>
                  已处理
                </button>
                <button type="button" className="btn" onClick={() => setResolving('rejected')}>
                  驳回
                </button>
              </div>
            </section>
          )}
          <ActionLinks d={detail} />
        </>
      )}
      {asking && (
        <ConfirmDialog
          title="查看单聊举报"
          needReason
          confirmLabel="查看"
          onClose={() => setAsking(false)}
          onConfirm={({ reason, ticket }) => view({ reason, ...(ticket ? { ticket } : {}) })}
        >
          单聊举报的元数据要填写理由，和单聊元数据查询共用每天 50 个会话的上限。
        </ConfirmDialog>
      )}
      {resolving && detail && (
        <ConfirmDialog
          title={resolving === 'handled' ? '结案：已处理' : '结案：驳回'}
          needReason
          confirmLabel={resolving === 'handled' ? '已处理' : '驳回'}
          onClose={() => setResolving(null)}
          onConfirm={async ({ reason, ticket }) => {
            try {
              await api('POST', `${base(id)}/resolve`, { result: resolving, reason, ...(ticket ? { ticket } : {}) });
            } catch (err) {
              // 别人先结案了（AC-MOD-04-5）：提示并刷新。
              if (err instanceof ApiError && err.code === 4098) {
                setNotice('举报已被处理');
                await view(viewArgs.current).catch(setError);
                return;
              }
              throw err;
            }
            setNotice('已结案');
            await view(viewArgs.current).catch(setError);
          }}
        >
          <p>结案只记录结论，不会自动删除消息、禁言或封禁；需要处置请用下面的链接到对应页面操作。</p>
        </ConfirmDialog>
      )}
    </>
  );
}
