import { useState, type ChangeEvent, type FormEvent } from 'react';
import { api } from '../api/client';
import type { BatchResult, ValidateResult } from '../api/types';
import { BatchOutcome, Preview, ValidationErrors } from '../components/BatchResult';
import { ConfirmDialog, ErrorNote, Field } from '../components/ui';

const VALIDATE = '/console/api/users/import/validate';

export function UserImportPage() {
  const [userId, setUserId] = useState('');
  const [nickname, setNickname] = useState('');
  const [avatar, setAvatar] = useState('');
  const [validated, setValidated] = useState<ValidateResult | null>(null);
  const [result, setResult] = useState<BatchResult | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const [confirming, setConfirming] = useState(false);

  const run = async (body: unknown) => {
    setBusy(true);
    setError(null);
    setResult(null);
    setValidated(null);
    try {
      setValidated(await api<ValidateResult>('POST', VALIDATE, body));
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  };
  const onFile = (e: ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (!f) return;
    const form = new FormData();
    form.set('file', f);
    void run(form);
    e.target.value = ''; // 同一个文件改完可以再选一次
  };
  const onSingle = (e: FormEvent) => {
    e.preventDefault();
    void run({ userId: userId.trim(), nickname: nickname.trim(), avatar: avatar.trim() });
  };
  return (
    <>
      <h1>用户导入</h1>
      <div className="two-col">
        <form className="panel" onSubmit={onSingle}>
          <h2>添加一个</h2>
          <Field label="userId">
            {(id) => <input id={id} value={userId} onChange={(e) => setUserId(e.target.value)} />}
          </Field>
          <Field label="昵称">
            {(id) => <input id={id} value={nickname} onChange={(e) => setNickname(e.target.value)} />}
          </Field>
          <Field label="头像地址">
            {(id) => <input id={id} value={avatar} onChange={(e) => setAvatar(e.target.value)} />}
          </Field>
          <button className="btn" type="submit" disabled={busy || !userId.trim()}>
            校验
          </button>
        </form>
        <div className="panel">
          <h2>上传 CSV</h2>
          <p>UTF-8 编码，表头 userId,nickname,avatar，最多 5000 行。同一个 userId 出现多次时以最后一条为准。</p>
          <Field label="选择文件">
            {(id) => <input id={id} type="file" accept=".csv,text/csv" onChange={onFile} disabled={busy} />}
          </Field>
        </div>
      </div>
      <ErrorNote error={error} />
      {validated && !validated.valid && (
        <ValidationErrors errors={validated.errors ?? []} total={validated.errorCount ?? 0} />
      )}
      {validated?.valid && (
        <section className="panel">
          <Preview
            result={validated}
            columns={[
              ['userId', 'userId'],
              ['nickname', '昵称'],
              ['avatar', '头像地址'],
            ]}
          />
          <button className="btn btn-primary" type="button" onClick={() => setConfirming(true)}>
            确认导入
          </button>
        </section>
      )}
      {result && <BatchOutcome result={result} />}
      {confirming && validated?.importToken && (
        <ConfirmDialog
          title="确认导入"
          onClose={() => setConfirming(false)}
          onConfirm={async () => {
            const r = await api<BatchResult>('POST', '/console/api/users/import', {
              importToken: validated.importToken,
            });
            setResult(r);
            setValidated(null);
          }}
        >
          将导入或更新 {validated.total} 个用户。
        </ConfirmDialog>
      )}
    </>
  );
}
