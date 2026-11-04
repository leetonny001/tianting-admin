import { useState, type ChangeEvent } from 'react';
import { api, ApiError } from '../api/client';
import type { BatchResult, ValidateResult } from '../api/types';
import { BatchOutcome, Preview, ValidationErrors } from '../components/BatchResult';
import { ConfirmDialog, ErrorNote, Field } from '../components/ui';

type Mode = 'import' | 'delete';

const help: Record<Mode, string> = {
  import: 'CSV 每行 a,b 或 a,b,备注A,备注B，最多 5000 行。备注不会出现在日志和审计里。',
  delete: 'CSV 每行 a,b，最多 5000 行。不是好友的会被忽略。',
};

export function FriendsBulkPage() {
  const [mode, setMode] = useState<Mode>('import');
  const [file, setFile] = useState<File | null>(null);
  const [validated, setValidated] = useState<ValidateResult | null>(null);
  const [result, setResult] = useState<BatchResult | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const reset = () => {
    setFile(null);
    setValidated(null);
    setResult(null);
    setError(null);
  };
  const onFile = async (e: ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    e.target.value = '';
    if (!f) return;
    reset();
    setFile(f);
    setBusy(true);
    const form = new FormData();
    form.set('file', f);
    try {
      setValidated(await api<ValidateResult>('POST', `/console/api/friends/${mode}/validate`, form));
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  };
  return (
    <>
      <h1>好友导入 / 删除</h1>
      <div className="tabs" role="tablist">
        {(['import', 'delete'] as Mode[]).map((m) => (
          <button
            key={m}
            type="button"
            role="tab"
            aria-selected={mode === m}
            className={mode === m ? 'tab tab-on' : 'tab'}
            onClick={() => {
              setMode(m);
              reset();
            }}
          >
            {m === 'import' ? '导入好友' : '删除好友'}
          </button>
        ))}
      </div>
      <div className="panel">
        <p>{help[mode]}</p>
        <Field label="选择文件">
          {(id) => <input id={id} type="file" accept=".csv,text/csv" onChange={onFile} disabled={busy} />}
        </Field>
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
              ['a', '用户 A'],
              ['b', '用户 B'],
            ]}
          />
          <button
            className={mode === 'import' ? 'btn btn-primary' : 'btn btn-danger'}
            type="button"
            onClick={() => setConfirming(true)}
          >
            {mode === 'import' ? '确认导入' : '确认删除'}
          </button>
        </section>
      )}
      {result && <BatchOutcome result={result} />}
      {confirming && validated?.importToken && file && (
        <ConfirmDialog
          title={mode === 'import' ? '确认导入好友' : '确认删除好友'}
          needReason
          danger={mode === 'delete'}
          onClose={() => setConfirming(false)}
          onConfirm={async ({ reason, ticket }) => {
            // 备注不存在服务端：提交时重新上传同一个文件，服务端按哈希核对。
            const form = new FormData();
            form.set('file', file);
            form.set('importToken', validated.importToken!);
            form.set('reason', reason);
            if (ticket) form.set('ticket', ticket);
            try {
              setResult(await api<BatchResult>('POST', `/console/api/friends/${mode}`, form));
              setValidated(null);
            } catch (err) {
              if (err instanceof ApiError && err.reason === 'fileChanged') setValidated(null);
              throw err;
            }
          }}
        >
          {mode === 'import'
            ? `将为 ${validated.total} 对用户建立双向好友关系，不受拉黑影响，也不解除拉黑。`
            : `将删除 ${validated.total} 对用户的好友关系，两边都看不到对方。`}
        </ConfirmDialog>
      )}
    </>
  );
}
