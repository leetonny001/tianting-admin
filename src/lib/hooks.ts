import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '../api/client';

/**
 * 页面可见时才轮询（FE-400 内容 4）。轮询请求由调用方带 X-Console-Background: 1，不续期空闲超时。
 */
export function usePolling(fn: () => void, intervalMs: number) {
  const saved = useRef(fn);
  useEffect(() => {
    saved.current = fn;
  });
  useEffect(() => {
    const tick = () => {
      if (document.visibilityState === 'visible') saved.current();
    };
    tick();
    const t = setInterval(tick, intervalMs);
    document.addEventListener('visibilitychange', tick);
    return () => {
      clearInterval(t);
      document.removeEventListener('visibilitychange', tick);
    };
  }, [intervalMs]);
}

/** 游标分页列表："加载更多"。key 变化时从头加载。 */
export function useCursorList<T>(buildUrl: ((cursor: string) => string) | null, field: string, key: string) {
  const [items, setItems] = useState<T[]>([]);
  const [next, setNext] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [loaded, setLoaded] = useState(false);
  const build = useRef(buildUrl);
  useEffect(() => {
    build.current = buildUrl;
  });
  const seq = useRef(0);

  const load = useCallback(
    async (cursor: string) => {
      const url = build.current;
      if (!url) return;
      const mine = ++seq.current;
      setLoading(true);
      setError(null);
      try {
        const data = await api<Record<string, unknown>>('GET', url(cursor));
        if (mine !== seq.current) return;
        const list = (data[field] as T[] | undefined) ?? [];
        setItems((old) => (cursor ? [...old, ...list] : list));
        setNext(String(data.nextCursor ?? ''));
        setLoaded(true);
      } catch (err) {
        if (mine === seq.current) setError(err);
      } finally {
        if (mine === seq.current) setLoading(false);
      }
    },
    [field],
  );

  useEffect(() => {
    if (key) void load('');
    else {
      setItems([]);
      setNext('');
      setLoaded(false);
    }
  }, [key, load]);

  return {
    items,
    loading,
    error,
    loaded,
    hasMore: next !== '' && next !== '0',
    loadMore: () => load(next),
    reload: () => load(''),
  };
}
