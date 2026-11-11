import { useState, type ChangeEvent, type FormEvent } from 'react';
import { api } from '../api/client';
import type { HitsInfo, WordImportResult, WordRow } from '../api/types';
import { Badge, ConfirmDialog, Empty, ErrorNote, Field, Text } from '../components/ui';
import { formatTime, idPattern } from '../lib/format';
import { useCursorList } from '../lib/hooks';
import { parseWordFile, sceneLabel, WORD_IMPORT_MAX, WORD_MAX } from '../lib/moderation';
import { useSession } from '../session';

const WORDS = '/console/api/moderation/words';

/**
 * 命中统计（F-MOD-02 规则 7）：按用户查次数（按场景）和最近记录。只对有 report.read 的显示（P-48 ③，console-chat 第 27 条）。
 * 响应里只有时间、场景、词 ID，没有任何内容；查询本身写审计。
 */
function HitsPanel() {
  const [userId, setUserId] = useState('');
  const [hits, setHits] = useState<HitsInfo | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const ok = idPattern.test(userId.trim());
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!ok || busy) return;
    setBusy(true);
    setError(null);
    setHits(null);
    try {
      setHits(await api<HitsInfo>('GET', `/console/api/moderation/hits?userId=${encodeURIComponent(userId.trim())}`));
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  };
  const scenes = hits ? Object.entries(hits.counts) : [];
  return (
    <section className="panel">
      <h2>命中统计</h2>
      <form className="row" onSubmit={submit}>
        <Field label="用户 ID">
          {(id) => <input id={id} value={userId} onChange={(e) => setUserId(e.target.value)} />}
        </Field>
        <button className="btn" type="submit" disabled={!ok || busy}>
          查询次数
        </button>
      </form>
      <ErrorNote error={error} />
      {hits && (
        <>
          <p className="muted">
            <Text>{hits.userId}</Text> 最近 {hits.days} 天的命中次数
          </p>
          {scenes.length === 0 ? (
            <Empty>没有命中记录</Empty>
          ) : (
            <table aria-label="按场景的命中次数">
              <thead>
                <tr>
                  <th>场景</th>
                  <th>次数</th>
                </tr>
              </thead>
              <tbody>
                {scenes.map(([scene, n]) => (
                  <tr key={scene}>
                    <td>
                      <Text>{sceneLabel(scene)}</Text>
                    </td>
                    <td>{n}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          {hits.recent.length > 0 && (
            <table aria-label="最近的命中">
              <thead>
                <tr>
                  <th>时间</th>
                  <th>场景</th>
                  <th>词 ID</th>
                </tr>
              </thead>
              <tbody>
                {hits.recent.map((h, i) => (
                  <tr key={`${h.at}-${i}`}>
                    <td className="nowrap">{formatTime(h.at)}</td>
                    <td>
                      <Text>{sceneLabel(h.scene)}</Text>
                    </td>
                    <td className="mono">{h.wordId}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </>
      )}
    </section>
  );
}

/**
 * 词库（FE-696，PRD-chat F-MOD-01，第 14.1 节）：列表、搜索、单个添加、停用 / 启用、删除、批量导入。
 * 词按纯文本显示（Text）；词列表只在内存里，不进本地存储。
 */
export function WordsPage() {
  const { can } = useSession();
  const [q, setQ] = useState('');
  const [query, setQuery] = useState('');
  const [nonce, setNonce] = useState(0);
  const list = useCursorList<WordRow>(
    (cursor) => {
      const p = new URLSearchParams();
      if (query) p.set('q', query);
      if (cursor) p.set('cursor', cursor);
      const s = p.toString();
      return s ? `${WORDS}?${s}` : WORDS;
    },
    'words',
    `${query}|${nonce}`,
  );
  const reload = () => setNonce((n) => n + 1);

  const [word, setWord] = useState('');
  const [adding, setAdding] = useState(false);
  const [addError, setAddError] = useState<unknown>(null);
  const [notice, setNotice] = useState('');
  const [toggling, setToggling] = useState<WordRow | null>(null);
  const [removing, setRemoving] = useState<WordRow | null>(null);
  const [pending, setPending] = useState<string[] | null>(null);
  const [fileError, setFileError] = useState('');
  const [imported, setImported] = useState<WordImportResult | null>(null);

  const trimmed = word.trim();
  const wordTooLong = [...trimmed].length > WORD_MAX;
  const add = async (e: FormEvent) => {
    e.preventDefault();
    if (!trimmed || wordTooLong || adding) return;
    setAdding(true);
    setAddError(null);
    setNotice('');
    try {
      const r = await api<{ word: WordRow; created: boolean }>('POST', WORDS, { word: trimmed });
      // 按标准化后去重（backend-chat 第 100 条）：已有的（含停用的）状态不变。
      setNotice(r.created ? '已添加' : '词库里已有这个词，状态不变');
      setWord('');
      reload();
    } catch (err) {
      setAddError(err);
    } finally {
      setAdding(false);
    }
  };

  const onFile = async (e: ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    e.target.value = ''; // 同一个文件改完可以再选一次
    setFileError('');
    setImported(null);
    setPending(null);
    if (!f) return;
    const words = parseWordFile(await f.arrayBuffer());
    if (words === null) {
      setFileError('文件不是 UTF-8 编码');
      return;
    }
    // 超过 5000 行不提交（AC-MOD-01-7，frontend-chat 第 86 条）。
    if (words.length > WORD_IMPORT_MAX) {
      setFileError(`一次最多 ${WORD_IMPORT_MAX} 条`);
      return;
    }
    if (words.length === 0) {
      setFileError('文件是空的');
      return;
    }
    setPending(words);
  };

  return (
    <>
      <h1>词库</h1>
      <p className="muted">命中词库的消息、昵称、群名等会被拦截。改动 10 秒内生效。仓库和截图只用特征词。</p>
      <div className="two-col">
        <form className="panel" onSubmit={add}>
          <h2>添加一个</h2>
          <Field label="词" hint={`最多 ${WORD_MAX} 个字`} error={wordTooLong ? `最多 ${WORD_MAX} 个字` : null}>
            {(id) => <input id={id} value={word} onChange={(e) => setWord(e.target.value)} autoComplete="off" />}
          </Field>
          <button className="btn btn-primary" type="submit" disabled={!trimmed || wordTooLong || adding}>
            添加
          </button>
          <ErrorNote error={addError} />
        </form>
        <div className="panel">
          <h2>批量导入</h2>
          <p>
            txt 文件，UTF-8 编码，一行一个，一次最多 {WORD_IMPORT_MAX} 条。空行和超过 {WORD_MAX} 个字的计为无效。
          </p>
          <Field label="选择文件">
            {(id) => <input id={id} type="file" accept=".txt,text/plain" onChange={(e) => void onFile(e)} />}
          </Field>
          {fileError && (
            <p className="note note-error" role="alert">
              {fileError}
            </p>
          )}
          {imported && (
            <p className="note note-ok" role="status">
              导入完成：新增 {imported.added}，重复 {imported.duplicate}，无效 {imported.invalid}
            </p>
          )}
        </div>
      </div>
      {notice && (
        <p className="note note-ok" role="status">
          {notice}
        </p>
      )}
      <form
        className="panel filters"
        onSubmit={(e) => {
          e.preventDefault();
          setQuery(q.trim());
        }}
      >
        <Field label="搜索">{(id) => <input id={id} value={q} onChange={(e) => setQ(e.target.value)} />}</Field>
        <div className="filters-submit">
          <button className="btn" type="submit">
            搜索
          </button>
        </div>
      </form>
      <ErrorNote error={list.error} />
      {list.loaded && list.items.length === 0 && <Empty>{query ? '没有匹配的词' : '词库是空的'}</Empty>}
      {list.items.length > 0 && (
        <table aria-label="词库">
          <thead>
            <tr>
              <th>原文</th>
              <th>状态</th>
              <th>更新时间</th>
              <th>操作</th>
            </tr>
          </thead>
          <tbody>
            {list.items.map((w) => (
              <tr key={w.wordId}>
                <td className="body-text">
                  <Text>{w.word}</Text>
                </td>
                <td>{w.state === 'active' ? <Badge tone="good">生效</Badge> : <Badge>已停用</Badge>}</td>
                <td className="nowrap">{formatTime(w.updatedAt)}</td>
                <td className="nowrap">
                  <button type="button" className="btn btn-small" onClick={() => setToggling(w)}>
                    {w.state === 'active' ? '停用' : '启用'}
                  </button>{' '}
                  <button type="button" className="btn btn-small btn-danger" onClick={() => setRemoving(w)}>
                    删除
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {list.hasMore && (
        <button type="button" className="btn more" disabled={list.loading} onClick={() => void list.loadMore()}>
          加载更多
        </button>
      )}
      {can('report.read') && <HitsPanel />}
      {toggling && (
        <ConfirmDialog
          title={toggling.state === 'active' ? '停用词' : '启用词'}
          confirmLabel={toggling.state === 'active' ? '停用' : '启用'}
          onClose={() => setToggling(null)}
          onConfirm={async () => {
            await api('PATCH', `${WORDS}/${toggling.wordId}`, {
              state: toggling.state === 'active' ? 'disabled' : 'active',
            });
            reload();
          }}
        >
          <p>
            将{toggling.state === 'active' ? '停用' : '启用'}词 <Text className="mono">{toggling.word}</Text>
            ，10 秒内生效。
          </p>
        </ConfirmDialog>
      )}
      {removing && (
        <ConfirmDialog
          title="删除词"
          danger
          confirmLabel="删除"
          onClose={() => setRemoving(null)}
          onConfirm={async () => {
            await api('DELETE', `${WORDS}/${removing.wordId}`);
            reload();
          }}
        >
          <p>
            将删除词 <Text className="mono">{removing.word}</Text>，不能恢复，10 秒内生效。
          </p>
        </ConfirmDialog>
      )}
      {pending && (
        <ConfirmDialog
          title="批量导入"
          confirmLabel="导入"
          onClose={() => setPending(null)}
          onConfirm={async () => {
            setImported(await api<WordImportResult>('POST', `${WORDS}/import`, { words: pending }));
            reload();
          }}
        >
          <p>将导入 {pending.length} 行。已有的词（含停用的）计为重复，状态不变。</p>
        </ConfirmDialog>
      )}
    </>
  );
}
