import { useCallback, useEffect, useState } from 'react';
import { MutedBadge, MuteDialog, UnmuteDialog } from '../components/Moderation';
import { Link, useNavigate, useParams } from 'react-router';
import { api } from '../api/client';
import type { BatchResult, GroupDetail, MemberRow } from '../api/types';
import { BatchOutcome } from '../components/BatchResult';
import { Badge, ConfirmDialog, Empty, ErrorNote, Field, Text } from '../components/ui';
import { formatTime, parseIds } from '../lib/format';
import { useCursorList } from '../lib/hooks';
import { useSession } from '../session';

const roleText: Record<string, string> = { owner: '群主', admin: '管理员', member: '成员' };

function Members({ groupId, canWrite, refresh }: { groupId: string; canWrite: boolean; refresh: () => void }) {
  const [input, setInput] = useState('');
  const [prefix, setPrefix] = useState('');
  const [pasted, setPasted] = useState('');
  const [batch, setBatch] = useState<BatchResult | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [dialog, setDialog] = useState<'add' | 'remove' | null>(null);
  const [muting, setMuting] = useState<{ userId: string; release: boolean } | null>(null);
  const { can } = useSession();
  const path = `/console/api/groups/${encodeURIComponent(groupId)}/members`;
  const list = useCursorList<MemberRow>(
    (cursor) => {
      const p = new URLSearchParams();
      if (prefix) p.set('prefix', prefix);
      if (cursor) p.set('cursor', cursor);
      return `${path}?${p}`;
    },
    'members',
    `${groupId}|${prefix}`,
  );
  const ids = parseIds(pasted);
  const done = (r: BatchResult) => {
    setBatch(r);
    setPasted('');
    list.reload();
    refresh();
  };
  return (
    <section className="panel">
      <h2>成员</h2>
      <form
        className="row"
        onSubmit={(e) => {
          e.preventDefault();
          setPrefix(input.trim());
        }}
      >
        <Field label="筛选" hint="userId 的开头">
          {(id) => <input id={id} value={input} onChange={(e) => setInput(e.target.value)} />}
        </Field>
        <button className="btn" type="submit">
          筛选
        </button>
      </form>
      <ErrorNote error={list.error} />
      {list.loaded && list.items.length === 0 && <Empty>没有成员</Empty>}
      {list.items.length > 0 && (
        <table>
          <thead>
            <tr>
              <th>userId</th>
              <th>角色</th>
              <th>入群时间</th>
              <th>禁言</th>
              {can('mute.write') && <th>操作</th>}
            </tr>
          </thead>
          <tbody>
            {list.items.map((m) => (
              <tr key={m.userId}>
                <td>
                  <Link to={`/users/${encodeURIComponent(m.userId)}`}>
                    <Text>{m.userId}</Text>
                  </Link>
                </td>
                <td>{roleText[m.role] ?? m.role}</td>
                <td>{formatTime(m.joinedAt)}</td>
                <td>
                  <MutedBadge row={m} />
                </td>
                {can('mute.write') && (
                  <td>
                    {m.mutedUntil !== undefined ? (
                      <button
                        type="button"
                        className="link"
                        onClick={() => setMuting({ userId: m.userId, release: true })}
                      >
                        解除
                      </button>
                    ) : (
                      <button
                        type="button"
                        className="link"
                        onClick={() => setMuting({ userId: m.userId, release: false })}
                      >
                        群内禁言
                      </button>
                    )}
                  </td>
                )}
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
      {canWrite && (
        <div className="member-edit">
          <Field label="加入或移除的成员" hint={`粘贴 userId，空格、逗号或换行分隔。已输入 ${ids.length} 个`}>
            {(id) => <textarea id={id} rows={3} value={pasted} onChange={(e) => setPasted(e.target.value)} />}
          </Field>
          <div className="actions">
            <button className="btn" type="button" disabled={ids.length === 0} onClick={() => setDialog('add')}>
              加入
            </button>
            <button
              className="btn btn-danger"
              type="button"
              disabled={ids.length === 0}
              onClick={() => setDialog('remove')}
            >
              移除
            </button>
          </div>
          <ErrorNote error={error} />
          {batch && <BatchOutcome result={batch} />}
        </div>
      )}
      {muting && !muting.release && (
        <MuteDialog
          userId={muting.userId}
          groupId={groupId}
          onDone={() => list.reload()}
          onClose={() => setMuting(null)}
        />
      )}
      {muting?.release && (
        <UnmuteDialog
          userId={muting.userId}
          groupId={groupId}
          onDone={() => list.reload()}
          onClose={() => setMuting(null)}
        />
      )}
      {dialog === 'add' && (
        <ConfirmDialog
          title="加入成员"
          onClose={() => setDialog(null)}
          onConfirm={async () => {
            setError(null);
            done(await api<BatchResult>('POST', path, { userIds: ids }));
          }}
        >
          将把 {ids.length} 个用户加入群 <Text>{groupId}</Text>。
        </ConfirmDialog>
      )}
      {dialog === 'remove' && (
        <ConfirmDialog
          title="移除成员"
          needReason
          danger
          onClose={() => setDialog(null)}
          onConfirm={async ({ reason, ticket }) => {
            setError(null);
            done(await api<BatchResult>('DELETE', path, { userIds: ids, reason, ...(ticket ? { ticket } : {}) }));
          }}
        >
          将把 {ids.length} 个用户移出群 <Text>{groupId}</Text>，他们会收到被移出的通知。
        </ConfirmDialog>
      )}
    </section>
  );
}

type Dialog = 'name' | 'history' | 'notice' | 'owner' | 'dissolve' | null;

export function GroupDetailPage() {
  const { id = '' } = useParams();
  const { can } = useSession();
  const navigate = useNavigate();
  const [group, setGroup] = useState<GroupDetail | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [name, setName] = useState('');
  const [notice, setNotice] = useState('');
  const [owner, setOwner] = useState('');
  const [dialog, setDialog] = useState<Dialog>(null);
  const path = `/console/api/groups/${encodeURIComponent(id)}`;
  const load = useCallback(() => {
    api<GroupDetail>('GET', path)
      .then((g) => {
        setGroup(g);
        setName(g.name);
        setNotice(g.notice ?? '');
        setError(null);
      })
      .catch(setError);
  }, [path]);
  useEffect(load, [load]);
  if (error && !group) {
    return (
      <>
        <h1>
          <Text>{id}</Text>
        </h1>
        <ErrorNote error={error} />
      </>
    );
  }
  if (!group) return <p className="loading">加载中…</p>;
  const canWrite = can('group.write');
  const nameLen = [...name.trim()].length;
  const nameError = nameLen === 0 ? '群名不能为空' : nameLen > 50 ? '群名最多 50 个字符' : null;
  const patch = (body: unknown) => api('PATCH', path, body).then(load);
  return (
    <>
      <div className="page-head">
        <h1>
          <Text>{group.name}</Text>
        </h1>
        <div className="actions">
          {can('msg.meta') && (
            <button
              className="btn"
              type="button"
              onClick={() => navigate('/messages', { state: { convId: `group:${group.groupId}` } })}
            >
              查看消息元数据
            </button>
          )}
          {can('group.dissolve') && (
            <button className="btn btn-danger" type="button" onClick={() => setDialog('dissolve')}>
              解散群
            </button>
          )}
        </div>
      </div>
      <ErrorNote error={error} />
      <section className="panel">
        <dl className="kv">
          <dt>群 ID</dt>
          <dd>
            <Text>{group.groupId}</Text>
          </dd>
          <dt>类型</dt>
          <dd>{group.managed ? <Badge>托管</Badge> : <Badge tone="warn">自建</Badge>}</dd>
          <dt>群主</dt>
          <dd>
            <Text>{group.owner || '—'}</Text>
          </dd>
          <dt>成员数</dt>
          <dd>{group.memberCount}</dd>
          <dt>新成员看历史</dt>
          <dd>{group.historyVisible ? '可以' : '不可以'}</dd>
          <dt>创建时间</dt>
          <dd>{formatTime(group.createdAt)}</dd>
          <dt>公告</dt>
          <dd>
            <Text>{group.notice || '—'}</Text>
          </dd>
        </dl>
      </section>
      {canWrite && (
        <section className="panel">
          <h2>群设置</h2>
          <div className="row">
            <Field label="群名" error={nameError}>
              {(fid) => <input id={fid} value={name} onChange={(e) => setName(e.target.value)} />}
            </Field>
            <button
              className="btn"
              type="button"
              disabled={!!nameError || name.trim() === group.name}
              onClick={() => setDialog('name')}
            >
              保存群名
            </button>
          </div>
          <div className="row">
            <Field label="公告">
              {(fid) => <input id={fid} value={notice} onChange={(e) => setNotice(e.target.value)} />}
            </Field>
            <button
              className="btn"
              type="button"
              disabled={notice === (group.notice ?? '')}
              onClick={() => setDialog('notice')}
            >
              保存公告
            </button>
          </div>
          <button className="btn" type="button" onClick={() => setDialog('history')}>
            {group.historyVisible ? '关闭新成员看历史' : '打开新成员看历史'}
          </button>
        </section>
      )}
      {can('group.owner') && (
        <section className="panel">
          <h2>群主</h2>
          <div className="row">
            <Field label="新群主 userId" hint="必须是群成员。留空表示收回群主">
              {(fid) => <input id={fid} value={owner} onChange={(e) => setOwner(e.target.value)} />}
            </Field>
            <button
              className="btn"
              type="button"
              disabled={!owner.trim() && !group.owner}
              onClick={() => setDialog('owner')}
            >
              {owner.trim() ? '设置群主' : '收回群主'}
            </button>
          </div>
        </section>
      )}
      <Members groupId={group.groupId} canWrite={canWrite} refresh={load} />
      {dialog === 'name' && (
        <ConfirmDialog title="修改群名" onClose={() => setDialog(null)} onConfirm={() => patch({ name: name.trim() })}>
          <Text>{group.name}</Text> → <Text>{name.trim()}</Text>
        </ConfirmDialog>
      )}
      {dialog === 'notice' && (
        <ConfirmDialog title="修改公告" onClose={() => setDialog(null)} onConfirm={() => patch({ notice })}>
          群成员下次拉取时会看到新公告。
        </ConfirmDialog>
      )}
      {dialog === 'history' && (
        <ConfirmDialog
          title="修改历史可见"
          onClose={() => setDialog(null)}
          onConfirm={() => patch({ historyVisible: !group.historyVisible })}
        >
          {group.historyVisible
            ? '只影响之后的查询：关闭后，新成员只能看到入群之后的消息。'
            : '只影响之后的查询：打开后，所有成员（包括已入群的）都能看到入群前的历史。'}
        </ConfirmDialog>
      )}
      {dialog === 'owner' && (
        <ConfirmDialog
          title={owner.trim() ? '设置群主' : '收回群主'}
          needReason
          onClose={() => setDialog(null)}
          onConfirm={async ({ reason, ticket }) => {
            await api('PUT', `${path}/owner`, { userId: owner.trim() || null, reason, ...(ticket ? { ticket } : {}) });
            setOwner('');
            load();
          }}
        >
          {owner.trim() ? (
            <>
              将把 <Text>{owner.trim()}</Text> 设为群主，群里会收到提示。
            </>
          ) : (
            '收回后群变成托管群，没有群主。'
          )}
        </ConfirmDialog>
      )}
      {dialog === 'dissolve' && (
        <ConfirmDialog
          title="解散群"
          needReason
          danger
          confirmText={group.groupId}
          confirmLabel="解散"
          onClose={() => setDialog(null)}
          onConfirm={async ({ reason, ticket }) => {
            await api('POST', `${path}/dissolve`, {
              reason,
              confirmGroupId: group.groupId,
              ...(ticket ? { ticket } : {}),
            });
            navigate('/groups', { replace: true });
          }}
        >
          <p>
            将解散群 <Text>{group.name}</Text>（{group.memberCount}{' '}
            人）：全部成员被移出，会话从他们的列表消失，消息保留。
          </p>
          <p>解散不能撤销，群 ID 也不能再用。</p>
        </ConfirmDialog>
      )}
    </>
  );
}
