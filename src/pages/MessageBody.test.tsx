import { describe, expect, it } from 'vitest';
import { watermarkText } from './MessageBody';
import { muteDuration } from '../components/Moderation';

describe('水印与禁言时长', () => {
  it('水印是账号名 + 到分钟的时间 + 授权前 8 位', () => {
    const t = new Date(2027, 0, 2, 3, 4, 59).getTime();
    expect(watermarkText('mod1', t, 'abcd1234')).toBe('mod1 2027-01-02 03:04 abcd1234');
  });
  it('自定义时长 1 分钟～30 天', () => {
    expect(muteDuration('1h', '')).toEqual({ duration: '1h' });
    expect(muteDuration('permanent', '')).toEqual({ duration: 'permanent' });
    expect(muteDuration('custom', '1')).toEqual({ customSeconds: 60 });
    expect(muteDuration('custom', String(30 * 24 * 60))).toEqual({ customSeconds: 2592000 });
    for (const bad of ['0', '-1', '1.5', 'x', '', String(30 * 24 * 60 + 1)]) {
      expect(muteDuration('custom', bad)).toBeNull();
    }
  });
});
