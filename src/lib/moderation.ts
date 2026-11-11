// 词库（PRD-chat C6，FE-696）的文案和纯函数。

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
