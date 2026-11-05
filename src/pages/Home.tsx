import { useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router';
import { DataOverview } from '../components/DataOverview';
import { Field } from '../components/ui';
import { useSession } from '../session';

export function HomePage() {
  const { can, session } = useSession();
  const [q, setQ] = useState('');
  const navigate = useNavigate();
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (q.trim()) navigate(`/users?q=${encodeURIComponent(q.trim())}`);
  };
  return (
    <>
      <h1>你好，{session?.account.displayName || session?.account.username}</h1>
      {can('stats.read') && <DataOverview />}
      {can('user.read') && (
        <form className="panel" onSubmit={submit}>
          <Field label="快捷搜索用户" hint="输入 userId 或昵称的开头">
            {(id) => <input id={id} value={q} onChange={(e) => setQ(e.target.value)} />}
          </Field>
          <button className="btn btn-primary" type="submit">
            搜索
          </button>
        </form>
      )}
    </>
  );
}

export function NoPermissionPage({ notFound }: { notFound?: boolean }) {
  return (
    <div className="panel">
      <h1>{notFound ? '页面不存在' : '无权限'}</h1>
      <p>{notFound ? '请从左侧菜单进入。' : '你的账号没有这个页面的权限。需要时请联系超级管理员。'}</p>
    </div>
  );
}
