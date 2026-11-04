import { useState, type FormEvent } from 'react';
import { Link, useSearchParams } from 'react-router';
import type { UserRow } from '../api/types';
import { Avatar, Badge, Empty, ErrorNote, Field, Text } from '../components/ui';
import { formatTime } from '../lib/format';
import { useCursorList } from '../lib/hooks';

export function UsersPage() {
  const [params, setParams] = useSearchParams();
  const q = params.get('q') ?? '';
  const official = params.get('official') === 'true';
  const [input, setInput] = useState(q);
  const [onlyOfficial, setOnlyOfficial] = useState(official);
  const [hint, setHint] = useState('');
  const active = q !== '' || official;
  const key = active ? `${q}|${official}` : '';
  const list = useCursorList<UserRow>(
    (cursor) => {
      const p = new URLSearchParams({ limit: '50' });
      if (q) p.set('q', q);
      if (official) p.set('official', 'true');
      if (cursor) p.set('cursor', cursor);
      return `/console/api/users?${p}`;
    },
    'users',
    key,
  );
  const submit = (e: FormEvent) => {
    e.preventDefault();
    const kw = input.trim();
    if (!kw && !onlyOfficial) {
      setHint('请输入关键字'); // 不发请求（AC-ADM-10-5）
      return;
    }
    setHint('');
    const next = new URLSearchParams();
    if (kw) next.set('q', kw);
    if (onlyOfficial) next.set('official', 'true');
    setParams(next);
  };
  return (
    <>
      <h1>用户</h1>
      <form className="panel row" onSubmit={submit}>
        <Field label="搜索" hint="userId 或昵称的开头" error={hint || null}>
          {(id) => <input id={id} value={input} onChange={(e) => setInput(e.target.value)} />}
        </Field>
        <label className="check">
          <input type="checkbox" checked={onlyOfficial} onChange={(e) => setOnlyOfficial(e.target.checked)} />
          只看官方账号
        </label>
        <button className="btn btn-primary" type="submit">
          搜索
        </button>
      </form>
      <ErrorNote error={list.error} />
      {list.loaded && list.items.length === 0 && <Empty>没有找到用户</Empty>}
      {list.items.length > 0 && (
        <table>
          <thead>
            <tr>
              <th>用户</th>
              <th>昵称</th>
              <th>注册时间</th>
              <th>状态</th>
            </tr>
          </thead>
          <tbody>
            {list.items.map((u) => (
              <tr key={u.userId}>
                <td>
                  <Avatar name={u.nickname || u.userId} />
                  <Link to={`/users/${encodeURIComponent(u.userId)}`}>
                    <Text>{u.userId}</Text>
                  </Link>
                </td>
                <td>
                  <Text>{u.nickname}</Text>
                </td>
                <td>{formatTime(u.createdAt)}</td>
                <td>
                  {u.online ? <Badge tone="good">在线</Badge> : <Badge>离线</Badge>}
                  {u.official && <Badge tone="warn">官方</Badge>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {list.hasMore && (
        <button type="button" className="btn more" disabled={list.loading} onClick={list.loadMore}>
          加载更多
        </button>
      )}
    </>
  );
}
