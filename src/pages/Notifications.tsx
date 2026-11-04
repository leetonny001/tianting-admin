import { useEffect, useState } from 'react';
import { api } from '../api/client';
import type { NotificationRow } from '../api/types';
import { NOTIFICATIONS_READ } from '../components/Layout';
import { Badge, Empty, ErrorNote, Text } from '../components/ui';
import { formatTime, notificationNames } from '../lib/format';

function payloadText(p: Record<string, unknown>): string {
  const parts: string[] = [];
  if (p.who) parts.push(String(p.who));
  if (p.ip) parts.push(`来源 ${String(p.ip)}`);
  if (p.left !== undefined) parts.push(`剩余 ${String(p.left)} 个`);
  if (p.role) parts.push(`角色 ${String(p.role)}`);
  if (p.issue) parts.push(String(p.issue));
  if (p.seq) parts.push(`seq ${String(p.seq)}`);
  return parts.join('，');
}

export function NotificationsPage() {
  const [list, setList] = useState<NotificationRow[]>([]);
  const [next, setNext] = useState('');
  const [error, setError] = useState<unknown>(null);
  const [loaded, setLoaded] = useState(false);
  const load = async (cursor: string) => {
    const r = await api<{ notifications: NotificationRow[]; nextCursor: string }>(
      'GET',
      `/console/api/notifications${cursor ? `?cursor=${cursor}` : ''}`,
    );
    setList((old) => (cursor ? [...old, ...r.notifications] : r.notifications));
    setNext(r.nextCursor);
    setLoaded(true);
  };
  useEffect(() => {
    // 打开后标记已读（AC-CON-12-3）。先取列表，这样未读标记还看得到。
    load('')
      .then(() => api('POST', '/console/api/notifications/read', {}))
      .then(() => window.dispatchEvent(new Event(NOTIFICATIONS_READ)))
      .catch(setError);
  }, []);
  return (
    <>
      <h1>通知中心</h1>
      <ErrorNote error={error} />
      {loaded && list.length === 0 && <Empty>没有通知</Empty>}
      <ul className="notices">
        {list.map((n) => (
          <li key={n.id}>
            <div>
              <strong>{notificationNames[n.kind] ?? n.kind}</strong> {!n.read && <Badge tone="warn">未读</Badge>}
            </div>
            <Text className="muted">{payloadText(n.payload)}</Text>
            <div className="muted">{formatTime(n.createdAt)}</div>
          </li>
        ))}
      </ul>
      {next && (
        <button type="button" className="btn more" onClick={() => load(next).catch(setError)}>
          加载更多
        </button>
      )}
    </>
  );
}
