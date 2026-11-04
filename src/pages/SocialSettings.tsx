import { useEffect, useMemo, useState } from 'react';
import { api } from '../api/client';
import { ConfirmDialog, ErrorNote, Text } from '../components/ui';

const labels: Record<string, string> = {
  mode: '好友模式',
  maxFriends: '好友数上限',
  strangerMsgLimit: '陌生人消息条数上限',
  applyExpireDays: '好友申请有效天数',
  applyPerDay: '每天最多发出的好友申请',
  maxBlocks: '黑名单上限',
};

const modeImpact: Record<string, string> = {
  friends: '切换到 friends 后，非好友之间不能发私聊（返回 4035），官方账号不受影响。各节点 1 秒内生效。',
  open: '切换到 open 后，任何人都可以给任何人发私聊（受陌生人限额限制）。各节点 1 秒内生效。',
};

type Values = Record<string, string | number | boolean>;

export function SocialSettingsPage() {
  const [current, setCurrent] = useState<Values | null>(null);
  const [draft, setDraft] = useState<Values>({});
  const [error, setError] = useState<unknown>(null);
  const [confirming, setConfirming] = useState(false);
  const [saved, setSaved] = useState(false);
  useEffect(() => {
    api<Values>('GET', '/console/api/settings/social')
      .then((v) => {
        setCurrent(v);
        setDraft(v);
      })
      .catch(setError);
  }, []);
  const changes = useMemo(() => {
    if (!current) return [];
    return Object.keys(current).filter((k) => draft[k] !== current[k]);
  }, [current, draft]);
  const modeChanged = changes.includes('mode');
  const invalid = changes.some((k) => typeof current?.[k] === 'number' && !Number.isFinite(draft[k] as number));
  return (
    <>
      <h1>社交配置</h1>
      <ErrorNote error={error} />
      {current && (
        <section className="panel">
          <table>
            <thead>
              <tr>
                <th>参数</th>
                <th>当前值</th>
                <th>新值</th>
              </tr>
            </thead>
            <tbody>
              {Object.keys(current).map((k) => (
                <tr key={k}>
                  <td>{labels[k] ?? k}</td>
                  <td>
                    <Text>{String(current[k])}</Text>
                  </td>
                  <td>
                    <SettingInput
                      name={labels[k] ?? k}
                      field={k}
                      value={draft[k]!}
                      onChange={(v) => {
                        setSaved(false);
                        setDraft({ ...draft, [k]: v });
                      }}
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {saved && <p className="note note-ok">已保存</p>}
          <button
            className="btn btn-primary"
            type="button"
            disabled={changes.length === 0 || invalid}
            onClick={() => setConfirming(true)}
          >
            保存
          </button>
        </section>
      )}
      {confirming && current && (
        <ConfirmDialog
          title="确认修改社交配置"
          needReason
          confirmText={modeChanged ? String(draft.mode) : undefined}
          onClose={() => setConfirming(false)}
          onConfirm={async ({ reason }) => {
            const body: Record<string, unknown> = { reason };
            for (const k of changes) body[k] = draft[k];
            if (modeChanged) body.confirmMode = draft.mode;
            const v = await api<Values>('PATCH', '/console/api/settings/social', body);
            setCurrent(v);
            setDraft(v);
            setSaved(true);
          }}
        >
          <ul>
            {changes.map((k) => (
              <li key={k}>
                {labels[k] ?? k}：<Text>{String(current[k])}</Text> → <Text>{String(draft[k])}</Text>
              </li>
            ))}
          </ul>
          {modeChanged && <p className="note note-warn">{modeImpact[String(draft.mode)]}</p>}
        </ConfirmDialog>
      )}
    </>
  );
}

function SettingInput({
  name,
  field,
  value,
  onChange,
}: {
  name: string;
  field: string;
  value: string | number | boolean;
  onChange: (v: string | number | boolean) => void;
}) {
  if (field === 'mode') {
    return (
      <select aria-label={name} value={String(value)} onChange={(e) => onChange(e.target.value)}>
        <option value="friends">friends（只有好友能聊）</option>
        <option value="open">open（陌生人也能聊）</option>
      </select>
    );
  }
  if (typeof value === 'boolean') {
    return <input aria-label={name} type="checkbox" checked={value} onChange={(e) => onChange(e.target.checked)} />;
  }
  if (typeof value === 'number') {
    return (
      <input
        aria-label={name}
        type="number"
        value={Number.isNaN(value) ? '' : value}
        onChange={(e) => onChange(e.target.value === '' ? NaN : Number(e.target.value))}
      />
    );
  }
  return <input aria-label={name} value={value} onChange={(e) => onChange(e.target.value)} />;
}
