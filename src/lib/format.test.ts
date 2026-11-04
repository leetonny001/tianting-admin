import { describe, expect, it } from 'vitest';
import { parseIds, reasonValid, validConvId } from './format';

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
