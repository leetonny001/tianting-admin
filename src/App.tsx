import type { ReactNode } from 'react';
import { Navigate, Route, Routes } from 'react-router';
import { Layout } from './components/Layout';
import { AccountsPage } from './pages/Accounts';
import { ActivatePage, LoginPage, SetupPage } from './pages/Auth';
import { AuditPage } from './pages/Audit';
import { FriendsBulkPage } from './pages/FriendsBulk';
import { GroupCreatePage, GroupsPage } from './pages/Groups';
import { GroupDetailPage } from './pages/GroupDetail';
import { HomePage, NoPermissionPage } from './pages/Home';
import { InvitesPage } from './pages/Invites';
import { MetaPage } from './pages/Meta';
import { MessageBodyPage } from './pages/MessageBody';
import { NotificationsPage } from './pages/Notifications';
import { PushDraftsPage, PushNewPage, PushRecordsPage } from './pages/Push';
import { SettingsPage } from './pages/Settings';
import { SocialSettingsPage } from './pages/SocialSettings';
import { UserDetailPage } from './pages/UserDetail';
import { UserImportPage } from './pages/UserImport';
import { UsersPage } from './pages/Users';
import { useSession } from './session';

/** 路由守卫（FE-401）：每个路由声明权限点。权限只是界面提示，真正的判断在 console-server。 */
function Guard({ perm, children }: { perm?: string | string[]; children: ReactNode }) {
  const { session, can, signedOutReason } = useSession();
  if (session === undefined) return <p className="loading">加载中…</p>;
  if (session === null) {
    return (
      <Navigate to={signedOutReason ? `/login?reason=${encodeURIComponent(signedOutReason)}` : '/login'} replace />
    );
  }
  if (session.state === 'setup') return <Navigate to="/setup" replace />;
  const allowed = !perm || [perm].flat().some(can);
  return <Layout>{allowed ? children : <NoPermissionPage />}</Layout>;
}

export function App() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route path="/activate" element={<ActivatePage />} />
      <Route path="/setup" element={<SetupPage />} />
      <Route
        path="/"
        element={
          <Guard>
            <HomePage />
          </Guard>
        }
      />
      <Route
        path="/users"
        element={
          <Guard perm="user.read">
            <UsersPage />
          </Guard>
        }
      />
      <Route
        path="/users/import"
        element={
          <Guard perm="user.import">
            <UserImportPage />
          </Guard>
        }
      />
      <Route
        path="/users/:id"
        element={
          <Guard perm="user.read">
            <UserDetailPage />
          </Guard>
        }
      />
      <Route
        path="/invites"
        element={
          <Guard perm="account.invite">
            <InvitesPage />
          </Guard>
        }
      />
      <Route
        path="/social/friends"
        element={
          <Guard perm="social.write">
            <FriendsBulkPage />
          </Guard>
        }
      />
      <Route
        path="/social/settings"
        element={
          <Guard perm="social.settings">
            <SocialSettingsPage />
          </Guard>
        }
      />
      <Route
        path="/groups"
        element={
          <Guard perm="group.read">
            <GroupsPage />
          </Guard>
        }
      />
      <Route
        path="/groups/new"
        element={
          <Guard perm="group.write">
            <GroupCreatePage />
          </Guard>
        }
      />
      <Route
        path="/groups/:id"
        element={
          <Guard perm="group.read">
            <GroupDetailPage />
          </Guard>
        }
      />
      <Route
        path="/messages"
        element={
          <Guard perm="msg.meta">
            <MetaPage />
          </Guard>
        }
      />
      <Route
        path="/messages/body"
        element={
          <Guard perm="msg.read.group">
            <MessageBodyPage />
          </Guard>
        }
      />
      <Route
        path="/push/new"
        element={
          <Guard perm="push.user">
            <PushNewPage />
          </Guard>
        }
      />
      <Route
        path="/push/drafts"
        element={
          <Guard perm={['push.all.request', 'push.all.approve']}>
            <PushDraftsPage />
          </Guard>
        }
      />
      <Route
        path="/push/records"
        element={
          <Guard perm="push.records.read">
            <PushRecordsPage />
          </Guard>
        }
      />
      <Route
        path="/audit"
        element={
          <Guard perm="audit.read">
            <AuditPage />
          </Guard>
        }
      />
      <Route
        path="/accounts"
        element={
          <Guard perm="admin.manage">
            <AccountsPage />
          </Guard>
        }
      />
      <Route
        path="/notifications"
        element={
          <Guard>
            <NotificationsPage />
          </Guard>
        }
      />
      <Route
        path="/settings"
        element={
          <Guard>
            <SettingsPage />
          </Guard>
        }
      />
      <Route
        path="*"
        element={
          <Guard>
            <NoPermissionPage notFound />
          </Guard>
        }
      />
    </Routes>
  );
}
