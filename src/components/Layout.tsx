import { useEffect, useState, type ReactNode } from 'react';
import { Link, NavLink, useLocation, useNavigate } from 'react-router';
import { api } from '../api/client';
import { usePolling } from '../lib/hooks';
import { roleNames } from '../lib/format';
import { useSession } from '../session';
import { Text } from './ui';

// 菜单和路由守卫用同一个权限点。社交配置页要 social.settings：客服虽然能读配置，但 AC-ADM-05-3 要求菜单里没有它。
const menu: { to: string; label: string; perm?: string | string[]; end?: boolean }[] = [
  { to: '/', label: '首页', end: true },
  { to: '/users', label: '用户', perm: 'user.read', end: true },
  { to: '/users/import', label: '用户导入', perm: 'user.import' },
  { to: '/invites', label: '邀请码', perm: 'account.invite' },
  { to: '/social/friends', label: '好友导入 / 删除', perm: 'social.write' },
  { to: '/social/settings', label: '社交配置', perm: 'social.settings' },
  { to: '/groups', label: '群', perm: 'group.read' },
  { to: '/messages', label: '消息元数据', perm: 'msg.meta' },
  { to: '/moderation/words', label: '词库', perm: 'moderation.words' },
  { to: '/reports', label: '举报', perm: 'report.read' },
  { to: '/push/new', label: '发系统通知', perm: 'push.user' },
  { to: '/push/drafts', label: '全员通知草稿', perm: ['push.all.request', 'push.all.approve'] },
  { to: '/push/records', label: '通知发送记录', perm: 'push.records.read' },
  { to: '/audit', label: '审计日志', perm: 'audit.read' },
  { to: '/accounts', label: '账号管理', perm: 'admin.manage' },
];

export const NOTIFICATIONS_READ = 'tt-notifications-read';

function Bell() {
  const [unread, setUnread] = useState(0);
  usePolling(() => {
    api<{ unread: number }>('GET', '/console/api/notifications/unread-count', undefined, { background: true })
      .then((r) => setUnread(r.unread))
      .catch(() => undefined);
  }, 30_000);
  useEffect(() => {
    const clear = () => setUnread(0);
    window.addEventListener(NOTIFICATIONS_READ, clear);
    return () => window.removeEventListener(NOTIFICATIONS_READ, clear);
  }, []);
  return (
    <Link to="/notifications" className="bell" aria-label={`通知，${unread} 条未读`}>
      通知
      {unread > 0 && <span className="bell-count">{unread}</span>}
    </Link>
  );
}

export function Layout({ children }: { children: ReactNode }) {
  const { session, can, setSession, reload } = useSession();
  const navigate = useNavigate();
  const { pathname } = useLocation();
  // 每次切换页面都确认一次会话：被挤掉、角色变了，点菜单就能知道（AC-CON-05-12），不用等到发下一个请求。
  useEffect(() => {
    reload().catch(() => undefined);
  }, [pathname, reload]);
  if (!session) return null;
  const logout = async () => {
    await api('POST', '/console/api/auth/logout', {}).catch(() => undefined);
    setSession(null);
    navigate('/login', { replace: true });
  };
  const left = session.recoveryCodesLeft;
  return (
    <div className="shell">
      <nav className="side" aria-label="主菜单">
        <div className="brand">天听管理后台</div>
        <ul>
          {menu
            .filter((m) => !m.perm || [m.perm].flat().some(can))
            .map((m) => (
              <li key={m.to}>
                <NavLink to={m.to} end={m.end}>
                  {m.label}
                </NavLink>
              </li>
            ))}
        </ul>
      </nav>
      <div className="main">
        <header className="top">
          {left !== undefined && left <= 2 && (
            <Link to="/settings" className="top-warn">
              恢复码只剩 {left} 个，去重新生成
            </Link>
          )}
          <div className="top-right">
            <Bell />
            <Link to="/settings" className="top-user">
              <Text>{session.account.displayName || session.account.username}</Text>
            </Link>
            <span className="top-roles">{session.roles.map((r) => roleNames[r] ?? r).join('、')}</span>
            <button type="button" className="btn btn-small" onClick={logout}>
              退出
            </button>
          </div>
        </header>
        <main className="content">{children}</main>
      </div>
    </div>
  );
}
