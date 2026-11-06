import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { api, ApiError } from '../api/client';
import type { FriendRow, SessionRow, UserConvRow, UserGroupRow, UserRow } from '../api/types';
import { MutedBadge, MuteDialog, UnmuteDialog, untilText } from '../components/Moderation';
import { Avatar, Badge, ConfirmDialog, Empty, ErrorNote, Field, Text } from '../components/ui';
import { formatTime } from '../lib/format';
import { useCursorList } from '../lib/hooks';
import { useSession } from '../session';

interface SessionsResult {
  sessions: SessionRow[];
  partial: boolean;
  scope: string;
}

/** partial 时不能下"不在线"的结论（AC-ADM-14-6）。 */
function SessionsTable({ result }: { result: SessionsResult }) {
  return (
    <>
      {result.partial && (
        <p className="note note-warn">
          只查了部分节点，结果可能不完整：{result.sessions.length}{' '}
          个连接是目前能确认的，不代表用户在其他节点上没有连接。
        </p>
      )}
      {result.sessions.length === 0 ? (
        <Empty>{result.partial ? '已查询的节点上没有找到连接' : '没有在线连接'}</Empty>
      ) : (
        <table>
          <thead>
            <tr>
              <th>连接 ID</th>
              <th>平台</th>
              <th>建立时间</th>
              <th>节点</th>
              <th>IP（已脱敏）</th>
            </tr>
          </thead>
          <tbody>
            {result.sessions.map((s) => (
              <tr key={s.connId}>
                <td className="mono">
                  <Text>{s.connId}</Text>
                </td>
                <td>
                  <Text>{s.platform}</Text>
                </td>
                <td>{formatTime(s.connectedAt)}</td>
                <td>
                  <Text>{s.node}</Text>
                </td>
                <td>
                  <Text>{s.ip}</Text>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </>
  );
}

function Friends({ userId }: { userId: string }) {
  const [open, setOpen] = useState(false);
  const list = useCursorList<FriendRow>(
    (cursor) =>
      `/console/api/users/${encodeURIComponent(userId)}/friends${cursor ? `?cursor=${encodeURIComponent(cursor)}` : ''}`,
    'friends',
    open ? userId : '',
  );
  return (
    <section className="panel">
      <h2>好友列表</h2>
      {!open ? (
        <button className="btn" type="button" onClick={() => setOpen(true)}>
          查看好友列表
        </button>
      ) : (
        <>
          <ErrorNote error={list.error} />
          {list.loaded && list.items.length === 0 && <Empty>没有好友</Empty>}
          {list.items.length > 0 && (
            <table>
              <thead>
                <tr>
                  <th>对方 userId</th>
                  <th>来源</th>
                  <th>建立时间</th>
                </tr>
              </thead>
              <tbody>
                {list.items.map((f) => (
                  <tr key={f.userId}>
                    <td>
                      <Text>{f.userId}</Text>
                    </td>
                    <td>{f.source === 'admin' ? '后台导入' : '用户添加'}</td>
                    <td>{formatTime(f.createdAt)}</td>
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
      )}
    </section>
  );
}

const groupRoleText: Record<string, string> = { owner: '群主', admin: '管理员', member: '成员' };

/** 用户所在群（F-ADM-10 规则 2）：不写审计，打开详情就加载。不含已解散的群。 */
function UserGroups({ userId }: { userId: string }) {
  const list = useCursorList<UserGroupRow>(
    (cursor) =>
      `/console/api/users/${encodeURIComponent(userId)}/groups${cursor ? `?cursor=${encodeURIComponent(cursor)}` : ''}`,
    'groups',
    userId,
  );
  return (
    <section className="panel">
      <h2>所在群</h2>
      <ErrorNote error={list.error} />
      {list.loaded && list.items.length === 0 && <Empty>不在任何群里</Empty>}
      {list.items.length > 0 && (
        <table>
          <thead>
            <tr>
              <th>群 ID</th>
              <th>群名</th>
              <th>群内角色</th>
              <th>成员数</th>
              <th>入群时间</th>
            </tr>
          </thead>
          <tbody>
            {list.items.map((g) => (
              <tr key={g.groupId}>
                <td>
                  <Link to={`/groups/${encodeURIComponent(g.groupId)}`}>
                    <Text>{g.groupId}</Text>
                  </Link>
                </td>
                <td>
                  <Text>{g.name}</Text>
                </td>
                <td>{groupRoleText[g.role] ?? g.role}</td>
                <td>{g.memberCount}</td>
                <td>{formatTime(g.joinedAt)}</td>
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
    </section>
  );
}

const CONVS_PATH = '/console/api/users/convs/query';

interface ConvPage {
  convs: UserConvRow[];
  nextCursor: string;
}

/**
 * 用户会话列表（F-ADM-30 规则 1 ③）：打开先填理由，只显示会话 ID、类型、最后活跃时间。
 * POST：userId 和理由不进 URL。15 分钟内翻页不用再填；过了窗口服务端要理由（4000），这里让用户重新打开。
 */
function UserConvs({ userId }: { userId: string }) {
  const navigate = useNavigate();
  const [asking, setAsking] = useState(false);
  const [rows, setRows] = useState<UserConvRow[] | null>(null);
  const [next, setNext] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [expired, setExpired] = useState(false);
  const more = async () => {
    setBusy(true);
    setError(null);
    try {
      const page = await api<ConvPage>('POST', CONVS_PATH, { userId, cursor: next });
      setRows([...(rows ?? []), ...page.convs]);
      setNext(page.nextCursor);
    } catch (err) {
      if (err instanceof ApiError && err.code === 4000) {
        setRows(null);
        setNext('');
        setExpired(true);
      } else setError(err);
    } finally {
      setBusy(false);
    }
  };
  return (
    <section className="panel">
      <h2>会话列表</h2>
      {expired && (
        <p className="note note-warn" role="status">
          已超过 15 分钟，请重新填写理由打开。
        </p>
      )}
      {!rows && (
        <button className="btn" type="button" onClick={() => setAsking(true)}>
          查看会话列表
        </button>
      )}
      <ErrorNote error={error} />
      {rows && rows.length === 0 && <Empty>没有会话</Empty>}
      {rows && rows.length > 0 && (
        <table>
          <thead>
            <tr>
              <th>会话 ID</th>
              <th>类型</th>
              <th>最后活跃</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((c) => (
              <tr key={c.convId}>
                <td>
                  <button
                    type="button"
                    className="link mono"
                    onClick={() => navigate('/messages', { state: { convId: c.convId } })}
                  >
                    <Text>{c.convId}</Text>
                  </button>
                </td>
                <td>{c.type === 'c2c' ? '单聊' : c.type === 'group' ? '群聊' : <Text>{c.type}</Text>}</td>
                <td>{formatTime(c.updatedAt)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {next && (
        <button type="button" className="btn more" disabled={busy} onClick={() => void more()}>
          加载更多
        </button>
      )}
      {asking && (
        <ConfirmDialog
          title="查看会话列表"
          needReason
          confirmLabel="查询"
          onClose={() => setAsking(false)}
          onConfirm={async ({ reason, ticket }) => {
            const page = await api<ConvPage>('POST', CONVS_PATH, {
              userId,
              reason,
              ...(ticket ? { ticket } : {}),
            });
            setExpired(false);
            setRows(page.convs);
            setNext(page.nextCursor);
          }}
        >
          单聊对方也是社交关系信息，查看会写审计。列表里没有正文和摘要。
        </ConfirmDialog>
      )}
    </section>
  );
}

export function UserDetailPage() {
  const { id = '' } = useParams();
  const { can } = useSession();
  const [user, setUser] = useState<UserRow | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [dialog, setDialog] = useState<'kick' | 'sessions' | 'official' | 'ban' | 'unban' | 'mute' | 'unmute' | null>(
    null,
  );
  const [banFor, setBanFor] = useState('1d');
  const [sessions, setSessions] = useState<SessionsResult | null>(null);
  const [notice, setNotice] = useState('');
  const [showAvatar, setShowAvatar] = useState(false);
  const path = `/console/api/users/${encodeURIComponent(id)}`;
  const load = useCallback(() => {
    setError(null);
    return api<UserRow>('GET', path)
      .then(setUser)
      .catch((err) => {
        setUser(null);
        setError(err);
      });
  }, [path]);
  useEffect(() => {
    void load();
  }, [load]);
  if (error && !user) {
    return (
      <>
        <h1>
          <Text>{id}</Text>
        </h1>
        <ErrorNote error={error} />
      </>
    );
  }
  if (!user) return <p className="loading">加载中…</p>;
  const name = user.nickname || user.userId;
  const deviceText = sessions ? `${sessions.sessions.length} 个` : '全部';
  return (
    <>
      <div className="page-head">
        <h1>
          <Avatar name={name} /> <Text>{user.userId}</Text>
        </h1>
        <div className="actions">
          <button className="btn" type="button" onClick={() => void load()}>
            刷新
          </button>
          {can('user.sessions') && (
            <button className="btn" type="button" onClick={() => setDialog('sessions')}>
              查看在线设备
            </button>
          )}
          {can('user.official') && (
            <button className="btn" type="button" onClick={() => setDialog('official')}>
              {user.official ? '取消官方账号' : '设为官方账号'}
            </button>
          )}
          {can('user.kick') && (
            <button className="btn btn-danger" type="button" onClick={() => setDialog('kick')}>
              强制下线
            </button>
          )}
          {can('mute.write') &&
            (user.mutedUntil !== undefined ? (
              <button className="btn" type="button" onClick={() => setDialog('unmute')}>
                解除禁言
              </button>
            ) : (
              <button className="btn btn-danger" type="button" onClick={() => setDialog('mute')}>
                禁言
              </button>
            ))}
          {can('user.ban') &&
            (user.ban ? (
              <button className="btn" type="button" onClick={() => setDialog('unban')}>
                解封
              </button>
            ) : (
              <button className="btn btn-danger" type="button" onClick={() => setDialog('ban')}>
                封禁
              </button>
            ))}
        </div>
      </div>
      {notice && (
        <p className="note note-ok" role="status">
          {notice}
        </p>
      )}
      <section className="panel">
        <dl className="kv">
          <dt>昵称</dt>
          <dd>
            <Text>{user.nickname || '—'}</Text>
          </dd>
          <dt>注册时间</dt>
          <dd>{formatTime(user.createdAt)}</dd>
          <dt>在线</dt>
          <dd>{user.online ? <Badge tone="good">在线</Badge> : <Badge>离线</Badge>}</dd>
          <dt>状态</dt>
          <dd>
            {user.ban ? (
              <>
                <Badge tone="bad">已封禁</Badge> 到期：{untilText(user.ban.until)}，理由：<Text>{user.ban.reason}</Text>
                ，操作人：
                <Text>{user.ban.by}</Text>
              </>
            ) : (
              '未封禁'
            )}{' '}
            <MutedBadge row={user} />
          </dd>
          <dt>官方账号</dt>
          <dd>{user.official ? <Badge tone="warn">官方</Badge> : '否'}</dd>
          <dt>头像</dt>
          <dd>
            {!user.avatar ? (
              '—'
            ) : showAvatar ? (
              <Text className="mono">{user.avatar}</Text>
            ) : (
              <button type="button" className="link" onClick={() => setShowAvatar(true)}>
                查看原图地址
              </button>
            )}
          </dd>
        </dl>
      </section>
      {sessions && (
        <section className="panel">
          <h2>在线设备</h2>
          <SessionsTable result={sessions} />
        </section>
      )}
      {can('social.read') && <Friends userId={user.userId} />}
      {can('group.read') && <UserGroups userId={user.userId} />}
      {can('msg.meta') && <UserConvs userId={user.userId} />}
      {dialog === 'kick' && (
        <ConfirmDialog
          title="强制下线"
          needReason
          danger
          onClose={() => setDialog(null)}
          onConfirm={async ({ reason, ticket }) => {
            await api('POST', `${path}/kick`, { reason, ...(ticket ? { ticket } : {}) });
            setNotice('已强制下线');
            setSessions(null);
            await load();
          }}
        >
          <p>
            将强制 <Text>{user.userId}</Text> 的{deviceText}在线设备下线。
          </p>
          <p>业务方重新签发凭证后用户即可再次登录；要阻止登录请使用封禁。</p>
        </ConfirmDialog>
      )}
      {dialog === 'ban' && (
        <ConfirmDialog
          title="封禁"
          needReason
          danger
          confirmLabel="封禁"
          onClose={() => setDialog(null)}
          onConfirm={async ({ reason, ticket }) => {
            await api('POST', `${path}/ban`, { duration: banFor, reason, ...(ticket ? { ticket } : {}) });
            await load();
          }}
        >
          <p>
            立即踢掉 <Text>{user.userId}</Text>{' '}
            的全部在线设备，封禁期间业务方也不能给他签发凭证。资料、好友、群和历史消息不变。
          </p>
          <Field label="时长">
            {(fid) => (
              <select id={fid} value={banFor} onChange={(e) => setBanFor(e.target.value)}>
                <option value="1h">1 小时</option>
                <option value="1d">1 天</option>
                <option value="7d">7 天</option>
                <option value="30d">30 天</option>
                <option value="permanent">永久</option>
              </select>
            )}
          </Field>
        </ConfirmDialog>
      )}
      {dialog === 'unban' && (
        <ConfirmDialog
          title="解封"
          needReason
          confirmLabel="解封"
          onClose={() => setDialog(null)}
          onConfirm={async ({ reason, ticket }) => {
            await api('POST', `${path}/unban`, { reason, ...(ticket ? { ticket } : {}) });
            await load();
          }}
        >
          解封后要由业务方重新签发凭证，用户才能登录。
        </ConfirmDialog>
      )}
      {dialog === 'mute' && <MuteDialog userId={user.userId} onDone={load} onClose={() => setDialog(null)} />}
      {dialog === 'unmute' && <UnmuteDialog userId={user.userId} onDone={load} onClose={() => setDialog(null)} />}
      {dialog === 'sessions' && (
        <ConfirmDialog
          title="查看在线设备"
          needReason
          confirmLabel="查询"
          onClose={() => setDialog(null)}
          onConfirm={async ({ reason, ticket }) => {
            // POST：userId 和理由不进 URL 和浏览器历史（AC-ADM-14-5）。
            const r = await api<SessionsResult>('POST', '/console/api/users/sessions/query', {
              userId: user.userId,
              reason,
              ...(ticket ? { ticket } : {}),
            });
            setSessions(r);
          }}
        >
          查看在线设备会写审计，每天最多查 50 个不同的用户。
        </ConfirmDialog>
      )}
      {dialog === 'official' && (
        <ConfirmDialog
          title={user.official ? '取消官方账号' : '设为官方账号'}
          needReason
          onClose={() => setDialog(null)}
          onConfirm={async ({ reason, ticket }) => {
            await api('PUT', `${path}/official`, { official: !user.official, reason, ...(ticket ? { ticket } : {}) });
            await load();
          }}
        >
          官方账号不受好友制和陌生人限额限制，用户仍可以拉黑它。
        </ConfirmDialog>
      )}
    </>
  );
}
