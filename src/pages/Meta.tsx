import { useEffect, useRef, useState, type FormEvent } from 'react';
import { useLocation, useNavigate } from 'react-router';
import { api } from '../api/client';
import type { MessageMeta } from '../api/types';
import { ConfirmDialog, Empty, ErrorNote, Field, Text } from '../components/ui';
import { formatTime, messageTypeLabel, metaSize, validConvId } from '../lib/format';
import { useSession } from '../session';

const PATH = '/console/api/messages/meta/query';

interface Page {
  messages: MessageMeta[];
  hasMore: boolean;
}

/** 这个页面没有任何正文字段：类型里就没有。正文在 MessageBody 页面，要单独授权。 */
export function MetaPage() {
  const location = useLocation();
  const navigate = useNavigate();
  const { can } = useSession();
  const fromState = (location.state as { convId?: string } | null)?.convId ?? '';
  const [convId, setConvId] = useState(fromState);
  const [from, setFrom] = useState('');
  const [since, setSince] = useState('');
  const [until, setUntil] = useState('');
  const [rows, setRows] = useState<MessageMeta[] | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const [asking, setAsking] = useState(false);
  const [active, setActive] = useState('');
  const started = useRef(false);
  const formatOk = convId.trim() === '' || validConvId(convId.trim());

  const fetchPage = async (body: Record<string, unknown>) => {
    const query = { ...body };
    if (from.trim()) query.from = from.trim();
    if (since) query.sinceTs = new Date(since).getTime();
    if (until) query.untilTs = new Date(until).getTime();
    return api<Page>('POST', PATH, query);
  };
  const enter = async (reason?: string, ticket?: string) => {
    const conv = convId.trim();
    setBusy(true);
    setError(null);
    try {
      const page = await fetchPage({ convId: conv, ...(reason ? { reason } : {}), ...(ticket ? { ticket } : {}) });
      setRows(page.messages);
      setHasMore(page.hasMore);
      setActive(conv);
    } catch (err) {
      setRows(null);
      setError(err);
      throw err;
    } finally {
      setBusy(false);
    }
  };
  const submit = (e: FormEvent) => {
    e.preventDefault();
    const conv = convId.trim();
    if (!conv || !validConvId(conv)) return;
    if (conv.startsWith('c2c:')) setAsking(true);
    else void enter().catch(() => undefined);
  };
  const more = async () => {
    const last = rows?.[rows.length - 1];
    if (!last) return;
    setBusy(true);
    try {
      const page = await fetchPage({ convId: active, beforeSeq: last.seq });
      setRows([...(rows ?? []), ...page.messages]);
      setHasMore(page.hasMore);
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  };
  useEffect(() => {
    // 从群详情或用户会话列表进入：群直接查，单聊先填理由（F-ADM-30 规则 3）。
    if (fromState && !started.current) {
      started.current = true;
      if (fromState.startsWith('c2c:')) setAsking(true);
      else void enter().catch(() => undefined);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return (
    <>
      <h1>消息元数据</h1>
      <p className="muted">
        只显示发送时间、发送者、seq、类型和长度，不含正文；图片、文件消息也不显示文件名（文件名按正文对待）。查询会写审计；单聊要填理由，每天最多
        50 个不同的单聊。
      </p>
      <form className="panel filters" onSubmit={submit}>
        <Field
          label="会话 ID"
          hint="group:群ID 或 c2c:用户A:用户B（A、B 按字典序）"
          error={formatOk ? null : '会话 ID 格式不正确'}
        >
          {(id) => <input id={id} value={convId} onChange={(e) => setConvId(e.target.value)} />}
        </Field>
        <Field label="发送者">{(id) => <input id={id} value={from} onChange={(e) => setFrom(e.target.value)} />}</Field>
        <Field label="开始时间">
          {(id) => <input id={id} type="datetime-local" value={since} onChange={(e) => setSince(e.target.value)} />}
        </Field>
        <Field label="结束时间">
          {(id) => <input id={id} type="datetime-local" value={until} onChange={(e) => setUntil(e.target.value)} />}
        </Field>
        <div className="filters-submit">
          <button className="btn btn-primary" type="submit" disabled={busy || !convId.trim() || !formatOk}>
            查询
          </button>
        </div>
      </form>
      <ErrorNote error={error} />
      {active && rows && (
        <div className="actions">
          {can(active.startsWith('c2c:') ? 'msg.read.c2c' : 'msg.read.group') && (
            <button
              className="btn"
              type="button"
              onClick={() => navigate('/messages/body', { state: { convId: active } })}
            >
              查看正文
            </button>
          )}
          {can('msg.quarantine.read') && (
            <button
              className="btn"
              type="button"
              onClick={() => navigate('/messages/body', { state: { convId: active, quarantine: true } })}
            >
              查看隔离原文
            </button>
          )}
        </div>
      )}
      {rows && rows.length === 0 && <Empty>这个会话没有消息</Empty>}
      {rows && rows.length > 0 && (
        <table>
          <thead>
            <tr>
              <th>seq</th>
              <th>msgId</th>
              <th>发送者</th>
              <th>类型</th>
              <th>大小</th>
              <th>时间</th>
              <th>状态</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((m) => (
              <tr key={m.seq}>
                <td>{m.seq}</td>
                <td className="mono">
                  <Text>{m.msgId}</Text>
                </td>
                <td>
                  <Text>{m.from}</Text>
                </td>
                <td>
                  <Text>{messageTypeLabel(m.type)}</Text>
                </td>
                <td className="nowrap">{metaSize(m)}</td>
                <td className="nowrap">{formatTime(m.ts)}</td>
                <td>
                  {m.deleted && (
                    <>
                      已删除（<Text>{m.deletedBy ?? ''}</Text>，{formatTime(m.deletedAt)}）
                    </>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {rows &&
        rows.length > 0 &&
        (hasMore ? (
          <button type="button" className="btn more" disabled={busy} onClick={more}>
            加载更多
          </button>
        ) : (
          <Empty>没有更多了</Empty>
        ))}
      {asking && (
        <ConfirmDialog
          title="查询单聊元数据"
          needReason
          confirmLabel="查询"
          onClose={() => setAsking(false)}
          onConfirm={({ reason, ticket }) => enter(reason, ticket)}
        >
          查询单聊的元数据需要填写理由，15 分钟内翻页不用再填。
        </ConfirmDialog>
      )}
    </>
  );
}
