import { useEffect, useState, type FormEvent } from 'react';
import { api } from '../api/client';
import type { AuditRecord } from '../api/types';
import { Badge, Empty, ErrorNote, Field, Modal, Text } from '../components/ui';
import { actionNames, formatTime, resultNames, toLocalInput } from '../lib/format';

const DAY = 24 * 3600 * 1000;
const MAX_DAYS = 31;

function targetText(t: AuditRecord['target']): string {
  if (!t?.type && !t?.ids) return '—';
  const ids = (t.ids ?? []).join('、');
  const more =
    t.count && t.ids && t.count > t.ids.length ? ` 等 ${t.count} 个` : t.count && !t.ids ? ` ${t.count} 个` : '';
  return `${t.type ?? ''}${ids ? `：${ids}` : ''}${more}`;
}

function ResultBadge({ r }: { r: AuditRecord }) {
  if (r.resultMissing) return <Badge tone="warn">结果未知</Badge>;
  if (r.phase === 'intent') return <span className="muted">操作前</span>;
  const tone = r.result === 'success' ? 'good' : r.result === 'unknown' ? 'warn' : 'bad';
  return (
    <Badge tone={tone}>
      {resultNames[r.result] ?? r.result}
      {r.code ? ` ${r.code}` : ''}
    </Badge>
  );
}

interface RequestDetail {
  requestId: string;
  status: string;
  intent: AuditRecord | null;
  results: AuditRecord[];
  events: AuditRecord[];
}

function RecordFields({ r }: { r: AuditRecord }) {
  return (
    <dl className="kv">
      <dt>时间</dt>
      <dd>{formatTime(r.ts)}</dd>
      <dt>操作人</dt>
      <dd>
        <Text>{r.actor || r.username}</Text>
      </dd>
      <dt>角色</dt>
      <dd>
        <Text>{(r.roles ?? []).join('、')}</Text>
      </dd>
      <dt>来源</dt>
      <dd>
        <Text>{r.ip}</Text>
      </dd>
      <dt>对象</dt>
      <dd>
        <Text>{targetText(r.target)}</Text>
      </dd>
      <dt>理由</dt>
      <dd>
        <Text>{r.reason || '—'}</Text>
      </dd>
      <dt>工单号</dt>
      <dd>
        <Text>{r.ticket || '—'}</Text>
      </dd>
      <dt>参数</dt>
      <dd>
        <Text className="mono">{JSON.stringify(r.params)}</Text>
      </dd>
      <dt>结果</dt>
      <dd>
        <ResultBadge r={r} />
      </dd>
      <dt>序号</dt>
      <dd>{r.seq}</dd>
    </dl>
  );
}

function Detail({ requestId, onClose }: { requestId: string; onClose: () => void }) {
  const [detail, setDetail] = useState<RequestDetail | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [im, setIm] = useState<Record<string, unknown>[] | null>(null);
  const [imError, setImError] = useState<unknown>(null);
  useEffect(() => {
    api<RequestDetail>('GET', `/console/api/audit/requests/${encodeURIComponent(requestId)}`)
      .then(setDetail)
      .catch(setError);
  }, [requestId]);
  const unknown = detail?.intent && detail.results.length === 0;
  return (
    <Modal title="审计详情" onClose={onClose} wide>
      <ErrorNote error={error} />
      <p className="muted mono">
        <Text>{requestId}</Text>
      </p>
      {unknown && <p className="note note-warn">结果未知：还没有结论，对账任务会补写（通常 15 分钟内）。</p>}
      {detail?.intent && (
        <>
          <h3>操作前（{actionNames[detail.intent.action] ?? detail.intent.action}）</h3>
          <RecordFields r={{ ...detail.intent, resultMissing: !!unknown }} />
        </>
      )}
      {detail?.results.map((r) => (
        <div key={r.seq}>
          <h3>结果{r.params && 'reconciled' in r.params ? '（对账补写）' : ''}</h3>
          <RecordFields r={r} />
        </div>
      ))}
      {detail?.events.map((r) => (
        <div key={r.seq}>
          <h3>事件（{actionNames[r.action] ?? r.action}）</h3>
          <RecordFields r={r} />
        </div>
      ))}
      <h3>im-server 侧记录</h3>
      <ErrorNote error={imError} />
      {im === null ? (
        <button
          type="button"
          className="btn btn-small"
          onClick={() => {
            setImError(null);
            api<{ entries: Record<string, unknown>[] }>(
              'GET',
              `/console/api/audit/im?requestId=${encodeURIComponent(requestId)}`,
            )
              .then((r) => setIm(r.entries ?? []))
              .catch(setImError);
          }}
        >
          查看 im-server 侧记录
        </button>
      ) : im.length === 0 ? (
        <Empty>im-server 侧没有这个请求的记录</Empty>
      ) : (
        <table>
          <thead>
            <tr>
              <th>时间</th>
              <th>阶段</th>
              <th>接口</th>
              <th>结果码</th>
            </tr>
          </thead>
          <tbody>
            {im.map((e) => (
              <tr key={String(e.id)}>
                <td>{formatTime(e.ts as number)}</td>
                <td>{e.phase === 'intent' ? '操作前' : '结果'}</td>
                <td>
                  <Text>{String(e.route ?? '')}</Text>
                </td>
                <td>{String(e.code ?? 0)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <div className="modal-actions">
        <button type="button" className="btn" onClick={onClose}>
          关闭
        </button>
      </div>
    </Modal>
  );
}

export function AuditPage() {
  const [from, setFrom] = useState(() => toLocalInput(Date.now() - 7 * DAY));
  const [to, setTo] = useState(() => toLocalInput(Date.now() + DAY));
  const [actor, setActor] = useState('');
  const [action, setAction] = useState('');
  const [target, setTarget] = useState('');
  const [result, setResult] = useState('');
  const [requestId, setRequestId] = useState('');
  const [records, setRecords] = useState<AuditRecord[] | null>(null);
  const [next, setNext] = useState(0);
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const [detail, setDetail] = useState<string | null>(null);
  const span = new Date(to).getTime() - new Date(from).getTime();
  const tooLong = span > MAX_DAYS * DAY;
  const invalid = !from || !to || span < 0 || tooLong;

  const query = async (cursor: number) => {
    const p = new URLSearchParams({
      from: String(new Date(from).getTime()),
      to: String(new Date(to).getTime()),
      limit: '50',
    });
    if (actor.trim()) p.set('actor', actor.trim());
    if (action) p.set('action', action);
    if (target.trim()) p.set('target', target.trim());
    if (result) p.set('result', result);
    if (requestId.trim()) p.set('requestId', requestId.trim());
    if (cursor) p.set('cursor', String(cursor));
    setBusy(true);
    setError(null);
    try {
      const r = await api<{ records: AuditRecord[]; nextCursor: number }>('GET', `/console/api/audit?${p}`);
      setRecords((old) => (cursor && old ? [...old, ...r.records] : r.records));
      setNext(r.nextCursor);
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  };
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!invalid) void query(0);
  };
  return (
    <>
      <h1>审计日志</h1>
      <form className="panel filters" onSubmit={submit}>
        <Field label="开始时间">
          {(id) => <input id={id} type="datetime-local" value={from} onChange={(e) => setFrom(e.target.value)} />}
        </Field>
        <Field label="结束时间" error={tooLong ? '最长 31 天' : null}>
          {(id) => <input id={id} type="datetime-local" value={to} onChange={(e) => setTo(e.target.value)} />}
        </Field>
        <Field label="操作人">
          {(id) => <input id={id} value={actor} onChange={(e) => setActor(e.target.value)} />}
        </Field>
        <Field label="动作">
          {(id) => (
            <select id={id} value={action} onChange={(e) => setAction(e.target.value)}>
              <option value="">全部</option>
              {Object.entries(actionNames).map(([k, v]) => (
                <option key={k} value={k}>
                  {v}
                </option>
              ))}
            </select>
          )}
        </Field>
        <Field label="目标" hint="如 user:u1 或 u1">
          {(id) => <input id={id} value={target} onChange={(e) => setTarget(e.target.value)} />}
        </Field>
        <Field label="结果">
          {(id) => (
            <select id={id} value={result} onChange={(e) => setResult(e.target.value)}>
              <option value="">全部</option>
              {Object.entries(resultNames).map(([k, v]) => (
                <option key={k} value={k}>
                  {v}
                </option>
              ))}
            </select>
          )}
        </Field>
        <Field label="requestId">
          {(id) => <input id={id} value={requestId} onChange={(e) => setRequestId(e.target.value)} />}
        </Field>
        <div className="filters-submit">
          <button className="btn btn-primary" type="submit" disabled={invalid || busy}>
            查询
          </button>
        </div>
      </form>
      <ErrorNote error={error} />
      {records && records.length === 0 && <Empty>没有符合条件的记录</Empty>}
      {records && records.length > 0 && (
        <table>
          <thead>
            <tr>
              <th>时间</th>
              <th>操作人</th>
              <th>动作</th>
              <th>对象</th>
              <th>结果</th>
              <th>理由</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {records.map((r) => (
              <tr key={r.seq}>
                <td className="nowrap">{formatTime(r.ts)}</td>
                <td>
                  <Text>{r.actor || r.username}</Text>
                </td>
                <td>
                  <Text>{actionNames[r.action] ?? r.action}</Text>
                </td>
                <td>
                  <Text>{targetText(r.target)}</Text>
                </td>
                <td>
                  <ResultBadge r={r} />
                </td>
                <td>
                  <Text>{r.reason}</Text>
                </td>
                <td>
                  <button type="button" className="link" onClick={() => setDetail(r.requestId)}>
                    详情
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {next > 0 && (
        <button type="button" className="btn more" disabled={busy} onClick={() => query(next)}>
          加载更多
        </button>
      )}
      {detail && <Detail requestId={detail} onClose={() => setDetail(null)} />}
    </>
  );
}
