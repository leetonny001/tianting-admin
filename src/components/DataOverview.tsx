import { useState } from 'react';
import { api } from '../api/client';
import { formatTime } from '../lib/format';
import { usePolling } from '../lib/hooks';
import { ErrorNote, Text } from './ui';

export const STATS_REFRESH_MS = 60_000;

interface Stats {
  online: { total: number; byPlatform?: Record<string, number>; partial?: boolean; scope?: string };
  newUsersToday: number;
  messagesToday: number;
  groupsTotal: number;
  dayStart: number;
  serverTime: number;
}

const n = (v: number) => v.toLocaleString('zh-CN');

/**
 * 首页数据概览（FE-440、F-ADM-70）。每 60 秒刷新，页面不可见时暂停（usePolling）。
 * 第一次加载是用户打开页面；之后的刷新带 X-Console-Background，不续期会话，
 * 所以没人操作时 30 分钟后刷新会收到 4014，由 API 客户端和路由守卫跳登录页。
 */
export function DataOverview() {
  const [stats, setStats] = useState<Stats | null>(null);
  const [error, setError] = useState<unknown>(null);
  usePolling(() => {
    api<Stats>('GET', '/console/api/stats', undefined, { background: stats !== null })
      .then((s) => {
        setStats(s);
        setError(null);
      })
      .catch(setError);
  }, STATS_REFRESH_MS);
  const platforms = Object.entries(stats?.online.byPlatform ?? {}).sort(([a], [b]) => a.localeCompare(b));
  // 只有服务端明确说是全集群的数字，才不标注。B6 之前固定是 partial=true、scope=localNode。
  const wholeCluster = stats?.online.partial === false && stats.online.scope !== 'localNode';
  return (
    <section aria-label="数据概览">
      {/* 刷新失败时保留上一次的数字，并写明是什么时候的；从没成功过就没有卡片，不显示 0。 */}
      <ErrorNote error={error} />
      {stats && (
        <>
          <div className="cards">
            <section className="card" aria-label="在线连接数">
              <h2>在线连接数{wholeCluster ? '' : '（当前节点）'}</h2>
              <div className="card-big">{n(stats.online.total)}</div>
              <div className="card-sub">
                {platforms.length > 0 ? (
                  <Text>{platforms.map(([p, c]) => `${p} ${n(c)}`).join('、')}</Text>
                ) : (
                  '没有连接'
                )}
              </div>
              {!wholeCluster && <div className="card-sub muted">只统计接收请求的节点，不是集群总数</div>}
            </section>
            <section className="card" aria-label="今日新增用户">
              <h2>今日新增用户</h2>
              <div className="card-big">{n(stats.newUsersToday)}</div>
            </section>
            <section className="card" aria-label="今日消息数">
              <h2>今日消息数</h2>
              <div className="card-big">{n(stats.messagesToday)}</div>
              <div className="card-sub muted">不含群提示消息，含之后被删除的消息</div>
            </section>
            <section className="card" aria-label="群总数">
              <h2>群总数</h2>
              <div className="card-big">{n(stats.groupsTotal)}</div>
              <div className="card-sub muted">不含已解散的群</div>
            </section>
          </div>
          <p className="muted">
            数据时间 {formatTime(stats.serverTime)}；今日从 {formatTime(stats.dayStart)} 起算；每 60 秒刷新
          </p>
        </>
      )}
    </section>
  );
}
