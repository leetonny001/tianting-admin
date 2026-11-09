import { describe, expect, it } from 'vitest';
import { metaSize, parseIds, reasonValid, validConvId } from './format';

describe('format', () => {
  it('理由和服务端规则一致', () => {
    for (const [s, ok] of [
      ['', false],
      ['abc', false],
      ['aaaa', false],
      ['长长长长', false],
      ['abcd', true],
      [' 工单处理 ', true],
      ['长'.repeat(201), false],
      ['长'.repeat(199) + 'x', true],
    ] as const) {
      expect(reasonValid(s)).toBe(ok);
    }
  });
  it('会话 ID 和服务端规则一致', () => {
    for (const [s, ok] of [
      ['group:g1', true],
      ['room:r1', true],
      ['c2c:a:b', true],
      ['c2c:b:a', false],
      ['c2c:a', false],
      ['group:', false],
      ['x:y', false],
      ['group:a b', false],
    ] as const) {
      expect(validConvId(s)).toBe(ok);
    }
  });
  it('粘贴的 ID 去重', () => {
    expect(parseIds('a, b\nc  a，d')).toEqual(['a', 'b', 'c', 'd']);
  });
});

describe('metaSize：元数据页的大小（PRD-chat v1.4 第 14.1 节，P-37 ③）', () => {
  it('图片、文件显示 fileSize（人类可读）', () => {
    expect(metaSize({ type: 'file', bodyLength: 30, fileSize: 1_258_291 })).toBe('1.2 MB');
    expect(metaSize({ type: 'image', bodyLength: 30, fileSize: 2048 })).toBe('2 KB');
    expect(metaSize({ type: 'image', bodyLength: 30, fileSize: 131 })).toBe('131 B');
  });

  it('其他消息、没有 fileSize 的（已删除）照旧显示正文长度', () => {
    expect(metaSize({ type: 'text', bodyLength: 12 })).toBe('12');
    expect(metaSize({ type: 'text', bodyLength: 12, fileSize: 999 })).toBe('12');
    expect(metaSize({ type: 'image', bodyLength: 0 })).toBe('0');
    expect(metaSize({ type: 'file', bodyLength: 30 })).toBe('30');
  });
});
