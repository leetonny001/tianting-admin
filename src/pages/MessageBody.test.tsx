import { describe, expect, it } from 'vitest';
import { bodyText, watermarkText } from './MessageBody';
import { formatBytes, messageTypeLabel } from '../lib/format';
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

describe('正文页的图片和文件（FE-639，PRD-chat 第 14.1 节）', () => {
  const m = (type: string, body: object) => ({ seq: 1, msgId: 'm1', from: 'u1', type, ts: 1, body });
  it('文件凭正文授权显示文件名和大小，写明不可预览；内容不请求、不内联', () => {
    expect(
      bodyText(m('file', { file: { fileId: 'F1', name: '<b>报告</b>.pdf', size: 5 << 20, mime: 'application/pdf' } })),
    ).toBe('[文件] <b>报告</b>.pdf，5 MB（不可预览）');
    expect(
      bodyText(m('image', { image: { fileId: 'F2', width: 4000, height: 3000, size: 2 << 20, mime: 'image/jpeg' } })),
    ).toBe('[图片] 4000×3000，2 MB（不可预览）');
  });
  it('过期的文件名已清空：显示已过期', () => {
    expect(bodyText(m('file', { file: { fileId: 'F1', name: '', size: 9, expired: true } }))).toBe('[文件] 已过期');
    expect(bodyText(m('image', { image: { fileId: 'F2', expired: true } }))).toBe('[图片] 已过期');
  });
  it('文本照旧；不认识的类型按 JSON 原文', () => {
    expect(bodyText(m('text', { text: 'hi' }))).toBe('hi');
    expect(bodyText(m('custom', { data: { a: 1 } }))).toBe('{"data":{"a":1}}');
  });
  it('类型名和大小', () => {
    expect(['text', 'image', 'file', 'tip', 'x'].map(messageTypeLabel)).toEqual([
      '文本',
      '图片',
      '文件',
      '群通知',
      'x',
    ]);
    expect([0, 1536, 5 << 20, undefined].map(formatBytes)).toEqual(['0 B', '1.5 KB', '5 MB', '—']);
  });
});
