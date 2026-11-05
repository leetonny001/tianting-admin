import { useCallback, useEffect, useState, type ChangeEvent } from 'react';
import { Link } from 'react-router';
import { api, ApiError } from '../api/client';
import { errorText } from '../api/errors';
import type { PushDraft, PushPreview, PushRecord, PushSchema, PushTemplate, ValidateResult } from '../api/types';
import { ValidationErrors } from '../components/BatchResult';
import { Badge, ConfirmDialog, Empty, Field, Text } from '../components/ui';
import { formatTime, idPattern, parseIds, reasonValid } from '../lib/format';
import { buildData, fieldKind, type FormValues } from '../lib/pushForm';
import { useSession } from '../session';

const MAX_USERS = 1000;
const CONFIRM_TEXT = '全员发送';

/** 系统通知的错误文案：5040 不是"不要重复提交"，系统会自动确认（PRD-admin 2.3 节的例外）。 */
export function pushError(err: unknown): unknown {
  if (err instanceof ApiError && err.code === 5040) {
    return new ApiError(err.status, err.code, err.message, 'pushResultUnknown');
  }
  return err;
}

export function pushErrorText(err: unknown): string {
  if (err instanceof ApiError && err.code === 4042) {
    const list = err.details?.userIds;
    if (Array.isArray(list) && list.length > 0) return `这些用户不存在，整批未发送：${list.join('、')}`;
  }
  return errorText(pushError(err));
}

function PushNote({ error }: { error: unknown }) {
  if (!error) return null;
  if (error instanceof ApiError && error.code === -1) return null;
  return (
    <p className="note note-error" role="alert">
      {pushErrorText(error)}
    </p>
  );
}

function statusBadge(status: string | undefined) {
  switch (status) {
    case 'success':
      return <Badge tone="good">已发送</Badge>;
    case 'failed':
      return <Badge tone="bad">失败</Badge>;
    case 'unknown':
      return <Badge tone="warn">结果未知</Badge>;
    case 'sending':
    case 'replay_due':
      return <Badge tone="warn">确认中</Badge>;
    default:
      return null;
  }
}

/** 按模板的 JSON Schema 渲染字段。内容都是文本节点和受控输入，不解析 HTML。 */
export function SchemaForm({
  schema,
  values,
  errors,
  disabled,
  onChange,
}: {
  schema: PushSchema;
  values: FormValues;
  errors: Record<string, string>;
  disabled?: boolean;
  onChange: (next: FormValues) => void;
}) {
  const required = schema.required ?? [];
  return (
    <>
      {Object.entries(schema.properties ?? {}).map(([name, field]) => {
        const label = (field.title ?? name) + (required.includes(name) ? '' : '（可选）');
        const kind = fieldKind(field);
        const text = typeof values[name] === 'string' ? (values[name] as string) : '';
        const set = (v: string | boolean) => onChange({ ...values, [name]: v });
        return (
          <Field key={name} label={label} hint={field.description} error={errors[name] ?? null}>
            {(id) => {
              switch (kind) {
                case 'text':
                  return <input id={id} value={text} disabled={disabled} onChange={(e) => set(e.target.value)} />;
                case 'integer':
                case 'number':
                  return (
                    <input
                      id={id}
                      inputMode="numeric"
                      value={text}
                      disabled={disabled}
                      onChange={(e) => set(e.target.value)}
                    />
                  );
                case 'boolean':
                  return (
                    <input
                      id={id}
                      type="checkbox"
                      checked={values[name] === true}
                      disabled={disabled}
                      onChange={(e) => set(e.target.checked)}
                    />
                  );
                case 'select':
                  return (
                    <select id={id} value={text} disabled={disabled} onChange={(e) => set(e.target.value)}>
                      <option value="">请选择</option>
                      {field.enum?.map((v) => (
                        <option key={String(v)} value={String(v)}>
                          {String(v)}
                        </option>
                      ))}
                    </select>
                  );
                default:
                  return (
                    <textarea
                      id={id}
                      rows={kind === 'json' ? 4 : 3}
                      value={text}
                      disabled={disabled}
                      onChange={(e) => set(e.target.value)}
                    />
                  );
              }
            }}
          </Field>
        );
      })}
    </>
  );
}

interface Sent {
  kind: 'user' | 'all';
  created?: boolean;
  accepted?: number;
}

export function PushNewPage() {
  const { can } = useSession();
  const canAll = can('push.all.request');
  const [templates, setTemplates] = useState<PushTemplate[] | null>(null);
  const [target, setTarget] = useState<'user' | 'all'>('user');
  const [userText, setUserText] = useState('');
  const [csv, setCsv] = useState<ValidateResult | null>(null);
  const [type, setType] = useState('');
  const [values, setValues] = useState<FormValues>({});
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [reason, setReason] = useState('');
  const [ticket, setTicket] = useState('');
  const [preview, setPreview] = useState<{ body: PushPreview; data: Record<string, unknown> } | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState<Sent | null>(null);

  useEffect(() => {
    api<{ templates: PushTemplate[] }>('GET', '/console/api/push/templates')
      .then((r) => {
        setTemplates(r.templates);
        setType(r.templates[0]?.type ?? '');
      })
      .catch(setError);
  }, []);

  const template = templates?.find((t) => t.type === type);
  const userIds = parseIds(userText);
  const badIds = userIds.filter((id) => !idPattern.test(id));
  const usersOk =
    target === 'all' ||
    (csv?.valid && csv.importToken) ||
    (userIds.length > 0 && userIds.length <= MAX_USERS && badIds.length === 0);
  const reasonOk = reasonValid(reason);
  const targetBody = target === 'all' ? {} : csv?.importToken ? { importToken: csv.importToken } : { userIds };

  const onFile = async (e: ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    e.target.value = '';
    if (!f) return;
    const form = new FormData();
    form.set('file', f);
    setBusy(true);
    setError(null);
    setCsv(null);
    try {
      setCsv(await api<ValidateResult>('POST', '/console/api/push/targets/validate', form));
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  };

  // 发送前必须预览（F-ADM-50 规则 6）：发送按钮只在预览里，预览期间内容不能改。
  const doPreview = async () => {
    if (!template) return;
    const built = buildData(template.schema, values);
    setFieldErrors(built.errors);
    if (Object.keys(built.errors).length > 0) return;
    setBusy(true);
    setError(null);
    setSent(null);
    try {
      const body = await api<PushPreview>('POST', '/console/api/push/preview', {
        target,
        ...targetBody,
        type,
        data: built.data,
      });
      setPreview({ body, data: built.data });
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  };

  const reset = () => {
    setPreview(null);
    setUserText('');
    setCsv(null);
    setValues({});
    setReason('');
    setTicket('');
  };

  const send = async () => {
    if (!preview) return;
    setBusy(true);
    setError(null);
    try {
      if (target === 'user') {
        const r = await api<{ created: boolean; accepted?: number }>('POST', '/console/api/push/user', {
          ...targetBody,
          type,
          data: preview.data,
          reason: reason.trim(),
          ...(ticket.trim() ? { ticket: ticket.trim() } : {}),
        });
        setSent({ kind: 'user', created: r.created, accepted: r.accepted });
      } else {
        await api('POST', '/console/api/push/all/drafts', { type, data: preview.data, reason: reason.trim() });
        setSent({ kind: 'all' });
      }
      reset();
    } catch (err) {
      setError(err);
      // 结果未知：同一份内容不要再点一次，系统会用同一个 pushId 自动确认。
      if (err instanceof ApiError && err.code === 5040) reset();
    } finally {
      setBusy(false);
    }
  };

  if (templates && templates.length === 0) {
    return (
      <>
        <h1>发系统通知</h1>
        <Empty>还没有配置通知模板，请联系运维。</Empty>
      </>
    );
  }

  return (
    <>
      <h1>发系统通知</h1>
      <PushNote error={error} />
      {sent && (
        <p className="note note-ok" role="status">
          {sent.kind === 'user' ? (
            `已发送，目标 ${sent.accepted ?? 0} 人。`
          ) : (
            <>
              草稿已提交，等待另一位超级管理员批准（24 小时内有效）。<Link to="/push/drafts">查看草稿</Link>
            </>
          )}
        </p>
      )}
      <div className="panel">
        <Field label="发送范围">
          {(id) => (
            <select
              id={id}
              value={target}
              disabled={!!preview}
              onChange={(e) => setTarget(e.target.value as 'user' | 'all')}
            >
              <option value="user">按用户</option>
              {canAll && <option value="all">全员（在线用户，需要另一位超管批准）</option>}
            </select>
          )}
        </Field>
        {target === 'user' && (
          <>
            <Field
              label="userId"
              hint={`空格、逗号或换行分隔，单次最多 ${MAX_USERS} 个；也可以上传 CSV`}
              error={
                badIds.length > 0
                  ? `格式不对：${badIds.slice(0, 5).join('、')}`
                  : userIds.length > MAX_USERS
                    ? `单次最多 ${MAX_USERS} 个，现在有 ${userIds.length} 个`
                    : null
              }
            >
              {(id) => (
                <textarea
                  id={id}
                  rows={3}
                  value={userText}
                  disabled={!!preview || !!csv}
                  onChange={(e) => setUserText(e.target.value)}
                />
              )}
            </Field>
            <Field label="上传 CSV（表头 userId）">
              {(id) => (
                <input id={id} type="file" accept=".csv" disabled={!!preview} onChange={(e) => void onFile(e)} />
              )}
            </Field>
            {csv && !csv.valid && <ValidationErrors errors={csv.errors ?? []} total={csv.errorCount ?? 0} />}
            {csv?.valid && (
              <p className="note note-ok">
                文件校验通过，{csv.total} 人。
                <button type="button" className="link" disabled={!!preview} onClick={() => setCsv(null)}>
                  改用手填
                </button>
              </p>
            )}
          </>
        )}
        <Field label="模板">
          {(id) => (
            <select
              id={id}
              value={type}
              disabled={!!preview}
              onChange={(e) => {
                setType(e.target.value);
                setValues({});
                setFieldErrors({});
              }}
            >
              {templates?.map((t) => (
                <option key={t.type} value={t.type}>
                  {t.title ? `${t.title}（${t.type}）` : t.type}
                </option>
              ))}
            </select>
          )}
        </Field>
        {template && (
          <SchemaForm
            schema={template.schema}
            values={values}
            errors={fieldErrors}
            disabled={!!preview}
            onChange={setValues}
          />
        )}
        <Field
          label="理由"
          hint="4～200 个字符"
          error={reason && !reasonOk ? '理由需要 4～200 个字符，不能由同一个字符重复组成' : null}
        >
          {(id) => (
            <textarea
              id={id}
              rows={2}
              value={reason}
              disabled={!!preview}
              onChange={(e) => setReason(e.target.value)}
            />
          )}
        </Field>
        {target === 'user' && (
          <Field label="工单号（可选）">
            {(id) => <input id={id} value={ticket} disabled={!!preview} onChange={(e) => setTicket(e.target.value)} />}
          </Field>
        )}
        {!preview && (
          <button
            type="button"
            className="btn btn-primary"
            disabled={busy || !template || !usersOk || !reasonOk}
            onClick={() => void doPreview()}
          >
            预览
          </button>
        )}
      </div>
      {preview && (
        <div className="panel" aria-label="预览">
          <h2>预览</h2>
          <dl className="kv">
            <dt>目标</dt>
            <dd>{preview.body.target === 'all' ? '全员（当前在线的用户）' : `${preview.body.targetCount} 人`}</dd>
            <dt>类型</dt>
            <dd>
              <Text>{preview.body.type}</Text>
            </dd>
            <dt>内容</dt>
            <dd>
              <pre className="json-block" data-testid="push-preview-data">
                {preview.body.data}
              </pre>
            </dd>
          </dl>
          <div className="actions">
            <button type="button" className="btn" disabled={busy} onClick={() => setPreview(null)}>
              返回修改
            </button>
            <button type="button" className="btn btn-primary" disabled={busy} onClick={() => void send()}>
              {target === 'all' ? '提交全员草稿' : '发送'}
            </button>
          </div>
        </div>
      )}
    </>
  );
}

function ApproveDialog({
  draft,
  onDone,
  onClose,
}: {
  draft: PushDraft;
  onDone: () => Promise<void>;
  onClose: () => void;
}) {
  return (
    <ConfirmDialog
      title="批准并发送全员通知"
      danger
      confirmText={CONFIRM_TEXT}
      confirmLabel="批准并发送"
      onClose={onClose}
      onConfirm={async () => {
        try {
          await api('POST', `/console/api/push/all/drafts/${encodeURIComponent(draft.id)}/approve`, {
            confirmText: CONFIRM_TEXT,
          });
        } catch (err) {
          throw pushError(err);
        }
        await onDone();
      }}
    >
      <p>批准后立即发给当前在线的所有用户，不可撤回。离线用户不会补收。</p>
      <pre className="json-block">{draft.dataPretty}</pre>
    </ConfirmDialog>
  );
}

function draftStatus(d: PushDraft) {
  if (d.status === 'expired') return <Badge>已作废</Badge>;
  if (d.status === 'pending') return <Badge tone="warn">待批准</Badge>;
  return statusBadge(d.sendStatus) ?? <Badge tone="good">已批准</Badge>;
}

export function PushDraftsPage() {
  const { session, can } = useSession();
  const canRequest = can('push.all.request');
  const canApprove = can('push.all.approve');
  const [drafts, setDrafts] = useState<PushDraft[] | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [approving, setApproving] = useState<PushDraft | null>(null);
  const [notice, setNotice] = useState('');

  const load = useCallback(async () => {
    try {
      // 只能批准的账号（超管）看待批准的；能发起的账号看全部。
      const path = canRequest ? '/console/api/push/all/drafts' : '/console/api/push/all/drafts/pending';
      setDrafts((await api<{ drafts: PushDraft[] }>('GET', path)).drafts);
    } catch (err) {
      setError(err);
    }
  }, [canRequest]);
  useEffect(() => {
    void load();
  }, [load]);

  return (
    <>
      <h1>全员通知草稿</h1>
      <PushNote error={error} />
      {notice && (
        <p className="note note-ok" role="status">
          {notice}
        </p>
      )}
      {drafts && drafts.length === 0 && <Empty>没有草稿。</Empty>}
      {drafts && drafts.length > 0 && (
        <table>
          <thead>
            <tr>
              <th>发起人</th>
              <th>类型</th>
              <th>内容</th>
              <th>理由</th>
              <th>发起时间</th>
              <th>状态</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {drafts.map((d) => (
              <tr key={d.id}>
                <td>
                  <Text>{d.createdByName}</Text>
                </td>
                <td>
                  <Text>{d.type}</Text>
                </td>
                <td>
                  <pre className="json-block">{d.dataPretty}</pre>
                </td>
                <td>
                  <Text>{d.reason}</Text>
                </td>
                <td className="nowrap">{formatTime(d.createdAt)}</td>
                <td>
                  {draftStatus(d)}
                  {d.approvedByName && (
                    <p className="muted">
                      批准人 <Text>{d.approvedByName}</Text>
                    </p>
                  )}
                </td>
                <td>
                  {/* 不能批准自己发起的：按钮隐藏。服务端的 403 / 4030 仍然会处理。 */}
                  {canApprove && d.status === 'pending' && d.createdBy !== session?.account.id && (
                    <button type="button" className="btn btn-small btn-danger" onClick={() => setApproving(d)}>
                      批准
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {approving && (
        <ApproveDialog
          draft={approving}
          onClose={() => setApproving(null)}
          onDone={async () => {
            setNotice('已批准并发送。');
            await load();
          }}
        />
      )}
    </>
  );
}

export function PushRecordsPage() {
  const [records, setRecords] = useState<PushRecord[]>([]);
  const [next, setNext] = useState<number | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<unknown>(null);

  const load = useCallback(async (before: number | null) => {
    try {
      const r = await api<{ records: PushRecord[]; nextBefore: number | null }>(
        'GET',
        '/console/api/push/records' + (before ? `?before=${before}` : ''),
      );
      setRecords((old) => (before ? [...old, ...r.records] : r.records));
      setNext(r.nextBefore);
      setLoaded(true);
    } catch (err) {
      setError(err);
    }
  }, []);
  useEffect(() => {
    void load(null);
  }, [load]);

  return (
    <>
      <h1>通知发送记录</h1>
      <PushNote error={error} />
      {loaded && records.length === 0 && <Empty>还没有发送记录。</Empty>}
      {records.length > 0 && (
        <table>
          <thead>
            <tr>
              <th>时间</th>
              <th>目标</th>
              <th>类型</th>
              <th>内容全文</th>
              <th>发送人</th>
              <th>批准人</th>
              <th>状态</th>
            </tr>
          </thead>
          <tbody>
            {records.map((r) => (
              <tr key={r.id}>
                <td className="nowrap">{formatTime(r.sentAt)}</td>
                <td>{r.kind === 'all' ? '全员' : `${r.targetCount} 人`}</td>
                <td>
                  <Text>{r.type}</Text>
                </td>
                <td>
                  <pre className="json-block">{r.dataPretty}</pre>
                  <p className="muted mono">
                    SHA-256 <Text>{r.dataSha256}</Text>
                  </p>
                  <p className="muted">
                    理由 <Text>{r.reason}</Text>
                  </p>
                </td>
                <td>
                  <Text>{r.createdByName}</Text>
                </td>
                <td>{r.approvedByName ? <Text>{r.approvedByName}</Text> : '—'}</td>
                <td>
                  {statusBadge(r.status)}
                  {r.replayedAt && <p className="muted">已自动重放一次</p>}
                  {r.replayExpired && <p className="muted">超过 1 小时未自动重放，请判断是否新发</p>}
                  {r.errorCode ? <p className="muted">错误码 {r.errorCode}</p> : null}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {next !== null && (
        <button type="button" className="btn more" onClick={() => void load(next)}>
          加载更多
        </button>
      )}
    </>
  );
}
