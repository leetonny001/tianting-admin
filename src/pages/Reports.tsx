import { useState, type FormEvent } from 'react';
import { Link } from 'react-router';
import type { ReportItem } from '../api/types';
import { Empty, ErrorNote, Field, Text } from '../components/ui';
import { formatTime } from '../lib/format';
import { useCursorList } from '../lib/hooks';
import { reasonLabel, reportReasons, reportStates, stateLabel, targetText } from '../lib/moderation';

const REPORTS = '/console/api/reports';

interface Filters {
  state: string;
  reason: string;
  from: string;
  to: string;
}

// 默认只看待处理（协调方定的实现细节）；筛选里可以切到"全部"。
const initial: Filters = { state: 'pending', reason: '', from: '', to: '' };

/** 筛选条件 → 查询参数：状态、理由、时间（毫秒）。 */
export function reportQuery(f: Filters, cursor: string): string {
  const p = new URLSearchParams();
  if (f.state) p.set('state', f.state);
  if (f.reason) p.set('reason', f.reason);
  if (f.from) p.set('from', String(new Date(f.from).getTime()));
  if (f.to) p.set('to', String(new Date(f.to).getTime()));
  if (cursor) p.set('cursor', cursor);
  const s = p.toString();
  return s ? `${REPORTS}?${s}` : REPORTS;
}

/**
 * 举报队列（FE-697，PRD-chat F-MOD-04 规则 1）：按状态、理由、时间筛选；相同对象聚合显示"N 次"，点开看每条（AC-MOD-04-6）。
 * 队列里没有举报人、note 和正文；对象 ID 按纯文本显示。打开举报单才写审计（详情页）。
 */
export function ReportsPage() {
  const [form, setForm] = useState<Filters>(initial);
  const [applied, setApplied] = useState<Filters>(initial);
  const [nonce, setNonce] = useState(0);
  const [open, setOpen] = useState<Set<string>>(new Set());
  const list = useCursorList<ReportItem>(
    (cursor) => reportQuery(applied, cursor),
    'items',
    `${JSON.stringify(applied)}|${nonce}`,
  );
  const set = (patch: Partial<Filters>) => setForm((old) => ({ ...old, ...patch }));
  const submit = (e: FormEvent) => {
    e.preventDefault();
    setOpen(new Set());
    setApplied(form);
    setNonce((n) => n + 1);
  };
  const toggle = (key: string) =>
    setOpen((old) => {
      const next = new Set(old);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  return (
    <>
      <h1>举报</h1>
      <form className="panel filters" onSubmit={submit}>
        <Field label="状态">
          {(id) => (
            <select id={id} value={form.state} onChange={(e) => set({ state: e.target.value })}>
              <option value="">全部</option>
              {reportStates.map(([v, l]) => (
                <option key={v} value={v}>
                  {l}
                </option>
              ))}
            </select>
          )}
        </Field>
        <Field label="理由">
          {(id) => (
            <select id={id} value={form.reason} onChange={(e) => set({ reason: e.target.value })}>
              <option value="">全部</option>
              {reportReasons.map(([v, l]) => (
                <option key={v} value={v}>
                  {l}
                </option>
              ))}
            </select>
          )}
        </Field>
        <Field label="开始时间">
          {(id) => (
            <input id={id} type="datetime-local" value={form.from} onChange={(e) => set({ from: e.target.value })} />
          )}
        </Field>
        <Field label="结束时间">
          {(id) => (
            <input id={id} type="datetime-local" value={form.to} onChange={(e) => set({ to: e.target.value })} />
          )}
        </Field>
        <div className="filters-submit">
          <button className="btn btn-primary" type="submit">
            筛选
          </button>
        </div>
      </form>
      <ErrorNote error={list.error} />
      {list.loaded && list.items.length === 0 && <Empty>没有举报</Empty>}
      {list.items.length > 0 && (
        <table aria-label="举报队列">
          <thead>
            <tr>
              <th>举报对象</th>
              <th>次数</th>
              <th>最近一次</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {list.items.map((item) => {
              const expanded = open.has(item.targetKey);
              return (
                <tr key={item.targetKey}>
                  <td className="body-text">
                    <Text>{targetText(item)}</Text>
                    {expanded && (
                      <ul className="report-list" aria-label="每条举报">
                        {item.reports.map((r) => (
                          <li key={r.reportId}>
                            <Link
                              to={`/reports/${encodeURIComponent(r.reportId)}`}
                              state={{ c2c: item.convType === 'c2c' }}
                              className="mono"
                            >
                              <Text>{r.reportId}</Text>
                            </Link>{' '}
                            {reasonLabel(r.reason)} · {stateLabel(r.state)} · {formatTime(r.createdAt)}
                          </li>
                        ))}
                      </ul>
                    )}
                  </td>
                  <td className="nowrap">{item.count} 次</td>
                  <td className="nowrap">{formatTime(item.latestAt)}</td>
                  <td className="nowrap">
                    <button
                      type="button"
                      className="btn btn-small"
                      aria-expanded={expanded}
                      onClick={() => toggle(item.targetKey)}
                    >
                      {expanded ? '收起' : '查看每条'}
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
      {list.hasMore && (
        <button type="button" className="btn more" disabled={list.loading} onClick={() => void list.loadMore()}>
          加载更多
        </button>
      )}
    </>
  );
}
