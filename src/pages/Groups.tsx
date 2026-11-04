import { useState, type FormEvent } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router';
import { api } from '../api/client';
import type { GroupRow } from '../api/types';
import { Badge, Empty, ErrorNote, Field, Text } from '../components/ui';
import { formatTime, parseIds } from '../lib/format';
import { useCursorList } from '../lib/hooks';
import { useSession } from '../session';

export function GroupsPage() {
  const { can } = useSession();
  const [params, setParams] = useSearchParams();
  const q = params.get('q') ?? '';
  const dissolved = params.get('includeDissolved') === 'true';
  const [input, setInput] = useState(q);
  const [withDissolved, setWithDissolved] = useState(dissolved);
  const list = useCursorList<GroupRow>(
    (cursor) => {
      const p = new URLSearchParams({ limit: '50' });
      if (q) p.set('q', q);
      if (dissolved) p.set('includeDissolved', 'true');
      if (cursor) p.set('cursor', cursor);
      return `/console/api/groups?${p}`;
    },
    'groups',
    `list|${q}|${dissolved}`,
  );
  const submit = (e: FormEvent) => {
    e.preventDefault();
    const next = new URLSearchParams();
    if (input.trim()) next.set('q', input.trim());
    if (withDissolved) next.set('includeDissolved', 'true');
    setParams(next);
  };
  return (
    <>
      <div className="page-head">
        <h1>群</h1>
        {can('group.write') && (
          <Link className="btn btn-primary" to="/groups/new">
            建群
          </Link>
        )}
      </div>
      <form className="panel row" onSubmit={submit}>
        <Field label="搜索" hint="群 ID 或群名的开头">
          {(id) => <input id={id} value={input} onChange={(e) => setInput(e.target.value)} />}
        </Field>
        <label className="check">
          <input type="checkbox" checked={withDissolved} onChange={(e) => setWithDissolved(e.target.checked)} />
          包含已解散
        </label>
        <button className="btn btn-primary" type="submit">
          搜索
        </button>
      </form>
      <ErrorNote error={list.error} />
      {list.loaded && list.items.length === 0 && <Empty>没有找到群</Empty>}
      {list.items.length > 0 && (
        <table>
          <thead>
            <tr>
              <th>群 ID</th>
              <th>群名</th>
              <th>类型</th>
              <th>群主</th>
              <th>成员数</th>
              <th>新成员看历史</th>
              <th>创建时间</th>
              <th>状态</th>
            </tr>
          </thead>
          <tbody>
            {list.items.map((g) => (
              <tr key={g.groupId}>
                <td>
                  {g.dissolvedAt ? (
                    <Text>{g.groupId}</Text>
                  ) : (
                    <Link to={`/groups/${encodeURIComponent(g.groupId)}`}>
                      <Text>{g.groupId}</Text>
                    </Link>
                  )}
                </td>
                <td>
                  <Text>{g.name}</Text>
                </td>
                <td>{g.type === 'managed' ? '托管' : '自建'}</td>
                <td>
                  <Text>{g.owner ?? '—'}</Text>
                </td>
                <td>{g.memberCount}</td>
                <td>{g.historyVisible ? '可以' : '不可以'}</td>
                <td>{formatTime(g.createdAt)}</td>
                <td>
                  {g.dissolvedAt ? (
                    <Badge tone="bad">已解散 {formatTime(g.dissolvedAt)}</Badge>
                  ) : (
                    <Badge tone="good">正常</Badge>
                  )}
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

export function GroupCreatePage() {
  const navigate = useNavigate();
  const [groupId, setGroupId] = useState('');
  const [name, setName] = useState('');
  const [members, setMembers] = useState('');
  const [historyVisible, setHistoryVisible] = useState(false);
  const [owner, setOwner] = useState('');
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const ids = parseIds(members);
  const tooMany = ids.length > 2000;
  const nameLen = [...name.trim()].length;
  const nameOk = nameLen >= 1 && nameLen <= 50;
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (tooMany) return; // 不发请求（AC-ADM-21-4）
    setBusy(true);
    setError(null);
    try {
      await api('POST', '/console/api/groups', {
        groupId: groupId.trim(),
        name: name.trim(),
        members: ids,
        historyVisible,
        ...(owner.trim() ? { owner: owner.trim() } : {}),
      });
      navigate(`/groups/${encodeURIComponent(groupId.trim())}`);
    } catch (err) {
      setError(err);
      setBusy(false);
    }
  };
  return (
    <>
      <h1>建群</h1>
      <form className="panel" onSubmit={submit}>
        <Field label="群 ID" hint="字母、数字、_、-，不能以 ug- 开头。解散后也不能再用">
          {(id) => <input id={id} value={groupId} onChange={(e) => setGroupId(e.target.value)} />}
        </Field>
        <Field label="群名" hint="1～50 个字符">
          {(id) => <input id={id} value={name} onChange={(e) => setName(e.target.value)} />}
        </Field>
        <Field
          label="初始成员"
          hint={`粘贴 userId，空格、逗号或换行分隔。已输入 ${ids.length} 个`}
          error={tooMany ? '群成员最多 2000 人' : null}
        >
          {(id) => <textarea id={id} rows={4} value={members} onChange={(e) => setMembers(e.target.value)} />}
        </Field>
        <Field label="群主（可选）" hint="必须在初始成员里。不填就是托管群，没有群主">
          {(id) => <input id={id} value={owner} onChange={(e) => setOwner(e.target.value)} />}
        </Field>
        <label className="check">
          <input type="checkbox" checked={historyVisible} onChange={(e) => setHistoryVisible(e.target.checked)} />
          新成员能看到入群前的消息
        </label>
        <ErrorNote error={error} />
        <button className="btn btn-primary" type="submit" disabled={busy || !groupId.trim() || !nameOk || tooMany}>
          创建
        </button>
      </form>
    </>
  );
}
