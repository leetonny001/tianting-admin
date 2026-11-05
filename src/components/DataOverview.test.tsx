import { act, cleanup, render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { resetClient, setHooks } from '../api/client';
import { DataOverview } from './DataOverview';

type Reply = { status?: number; body: unknown };
let replies: Reply[];
let calls: Record<string, string>[];

const stats = (over: Record<string, unknown> = {}) => ({
  online: { total: 5, byPlatform: { web: 3, pc: 2 }, partial: true, scope: 'localNode' },
  newUsersToday: 1,
  messagesToday: 2,
  groupsTotal: 3,
  dayStart: 1_800_000_000_000,
  serverTime: 1_800_000_000_000,
  ...over,
});

function setVisibility(v: DocumentVisibilityState) {
  Object.defineProperty(document, 'visibilityState', { configurable: true, value: v });
}

const flush = () =>
  act(async () => {
    await vi.advanceTimersByTimeAsync(0);
  });
const after = (ms: number) =>
  act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });

async function open() {
  render(
    <MemoryRouter>
      <DataOverview />
    </MemoryRouter>,
  );
  await flush();
}

beforeEach(() => {
  vi.useFakeTimers();
  setVisibility('visible');
  resetClient();
  calls = [];
  replies = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (_path: string, init?: RequestInit) => {
      calls.push((init?.headers ?? {}) as Record<string, string>);
      const r = replies.length > 1 ? replies.shift()! : replies[0]!;
      return new Response(JSON.stringify(r.body), { status: r.status ?? 200 });
    }),
  );
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('数据概览（FE-440）', () => {
  it('显示 4 张卡片，在线数按平台（AC-ADM-70-1）', async () => {
    replies = [{ body: stats() }];
    await open();
    const online = screen.getByRole('region', { name: '在线连接数' });
    expect(within(online).getByText('5')).toBeVisible();
    expect(online).toHaveTextContent('pc 2、web 3');
    expect(screen.getByRole('region', { name: '今日新增用户' })).toHaveTextContent('1');
    expect(screen.getByRole('region', { name: '今日消息数' })).toHaveTextContent('2');
    expect(screen.getByRole('region', { name: '群总数' })).toHaveTextContent('3');
  });

  it('单节点范围要如实标注，不能显示成集群总数', async () => {
    replies = [{ body: stats() }];
    await open();
    const online = screen.getByRole('region', { name: '在线连接数' });
    expect(online).toHaveTextContent('在线连接数（当前节点）');
    expect(online).toHaveTextContent('只统计接收请求的节点，不是集群总数');
  });

  it('字段缺失时也按单节点标注；明确是全集群才去掉（B6）', async () => {
    replies = [{ body: stats({ online: { total: 5, byPlatform: {} } }) }];
    await open();
    expect(screen.getByRole('region', { name: '在线连接数' })).toHaveTextContent('不是集群总数');
    cleanup();
    replies = [{ body: stats({ online: { total: 5, partial: false, scope: 'cluster' } }) }];
    await open();
    expect(screen.getByRole('region', { name: '在线连接数' })).not.toHaveTextContent('不是集群总数');
  });

  it('没有连接：byPlatform 为空或缺失都不报错，显示没有连接', async () => {
    replies = [{ body: stats({ online: { total: 0, partial: true, scope: 'localNode' } }) }];
    await open();
    expect(screen.getByRole('region', { name: '在线连接数' })).toHaveTextContent('没有连接');
  });

  it('打开时不带后台头；每 60 秒刷新一次，带 X-Console-Background: 1（AC-ADM-70-1、70-2）', async () => {
    replies = [{ body: stats() }, { body: stats({ newUsersToday: 9 }) }];
    await open();
    expect(calls).toHaveLength(1);
    expect(calls[0]!['X-Console-Background']).toBeUndefined();
    await after(59_000);
    expect(calls).toHaveLength(1);
    await after(1_000);
    expect(calls).toHaveLength(2);
    expect(calls[1]!['X-Console-Background']).toBe('1');
    expect(screen.getByRole('region', { name: '今日新增用户' })).toHaveTextContent('9');
    await after(60_000);
    expect(calls).toHaveLength(3);
    expect(calls[2]!['X-Console-Background']).toBe('1');
  });

  it('页面不可见时暂停，回来时马上刷新', async () => {
    replies = [{ body: stats() }];
    await open();
    setVisibility('hidden');
    await after(300_000);
    expect(calls).toHaveLength(1);
    setVisibility('visible');
    await act(async () => {
      document.dispatchEvent(new Event('visibilitychange'));
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(calls).toHaveLength(2);
    expect(calls[1]!['X-Console-Background']).toBe('1');
  });

  it('刷新收到 4014：通知会话层（跳登录页由路由守卫做），原因是 idle', async () => {
    const onAuthRequired = vi.fn();
    setHooks({ onAuthRequired, onSetupRequired: vi.fn(), requestStepUp: vi.fn() });
    replies = [{ body: stats() }, { status: 401, body: { code: 4014, reason: 'idle' } }];
    await open();
    await after(60_000);
    expect(onAuthRequired).toHaveBeenCalledWith('idle');
  });

  it('第一次就失败：显示错误，不显示 0；之后失败保留上一次的数字并提示', async () => {
    replies = [{ status: 503, body: { code: 5030 } }];
    await open();
    expect(screen.getByRole('alert')).toBeVisible();
    expect(screen.queryByRole('region', { name: '在线连接数' })).toBeNull();
    cleanup();
    replies = [{ body: stats() }, { status: 503, body: { code: 5030 } }];
    await open();
    await after(60_000);
    expect(screen.getByRole('alert')).toBeVisible();
    expect(screen.getByRole('region', { name: '在线连接数' })).toHaveTextContent('5');
  });
});
