// 词库和举报（PRD-chat C6，FE-696、FE-697）的文案和纯函数。

/** 举报理由（frontend-chat 第 78 条，三端和后台一致）。 */
export const reportReasons: [string, string][] = [
  ['spam', '垃圾广告'],
  ['abuse', '辱骂骚扰'],
  ['porn', '色情低俗'],
  ['fraud', '诈骗'],
  ['illegal', '违法违规'],
  ['other', '其他'],
];

export const reportStates: [string, string][] = [
  ['pending', '待处理'],
  ['handled', '已处理'],
  ['rejected', '已驳回'],
];

const label = (table: [string, string][], v: string) => table.find(([k]) => k === v)?.[1] ?? v;
export const reasonLabel = (v: string) => label(reportReasons, v);
export const stateLabel = (v: string) => label(reportStates, v);

/** 命中场景（backend-chat 第 110 条）。不认识的原样显示。 */
export function sceneLabel(scene: string): string {
  return (
    {
      text: '文本消息',
      fileName: '文件名',
      nickname: '昵称',
      username: '用户名',
      groupName: '群名',
      groupNotice: '群公告',
      friendApply: '好友申请附言',
    }[scene] ?? scene
  );
}

/** 举报对象的说明（队列和详情）。单聊消息举报在队列里没有 convId、msgIds，要在详情里填理由才看（F-MOD-04 规则 2）。 */
export function targetText(t: {
  targetType: string;
  convType?: string;
  convId?: string;
  msgIds?: string[];
  userId?: string;
  groupId?: string;
}): string {
  if (t.targetType === 'user') return `用户 ${t.userId ?? ''}`;
  if (t.targetType === 'group') return `群 ${t.groupId ?? ''}`;
  if (t.targetType === 'message') {
    const kind = t.convType === 'c2c' ? '单聊消息' : '群消息';
    if (!t.convId) return `${kind}（打开时填写理由）`;
    return `${kind} ${t.convId}${t.msgIds?.length ? ` / ${t.msgIds.join('、')}` : ''}`;
  }
  return t.targetType;
}

/** 一次导入最多 5000 条（F-MOD-01 规则 1）。 */
export const WORD_IMPORT_MAX = 5000;
/** 单个词最多 64 个码点（F-MOD-01 异常，backend-chat 第 102 条）。 */
export const WORD_MAX = 64;

/**
 * 批量导入的 txt（frontend-chat 第 86 条）：UTF-8、一行一个，去掉首尾空白；空行留给服务端计入无效。
 * 文件末尾的换行不算一行；开头的 BOM 去掉。不是 UTF-8 的返回 null。
 */
export function parseWordFile(bytes: ArrayBuffer): string[] | null {
  let text: string;
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    return null;
  }
  if (text.startsWith('﻿')) text = text.slice(1);
  if (text === '') return [];
  const lines = text.split(/\r\n|\n|\r/);
  if (lines[lines.length - 1] === '') lines.pop();
  return lines.map((l) => l.trim());
}

/** 页面直接显示的图片类型（console 校验文件头后 inline 返回的那些，CS-208）。其他一律只给下载。 */
const inlineImages = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'];
export function inlineImage(type: string): boolean {
  return inlineImages.includes(type.split(';')[0]!.trim().toLowerCase());
}

/**
 * 证据图片用 data: 地址显示（console-chat 第 29 条）：取文件接口是 POST，<img src> 发不了；
 * blob: 要放宽 CSP（img-src 只有 'self' data:），不允许。
 */
export async function dataUrl(blob: Blob): Promise<string> {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return `data:${blob.type.split(';')[0]!.trim().toLowerCase()};base64,${btoa(bin)}`;
}
