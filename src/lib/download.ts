// 把内存里的字节交给浏览器另存（FE-671，CS-202）：不内联渲染、不打开新页面。
// 文件名不进 URL（blob: 地址是随机的），也不写日志；blob 地址用完马上撤销，字节不在页面里留着。

/** 撤销 blob 地址前等多久：Chrome 点击时就拿到了字节，其他浏览器开始下载要晚一点。 */
export const REVOKE_AFTER_MS = 1000;

export function saveBlob(blob: Blob, name: string, doc: Document = document): void {
  const url = URL.createObjectURL(blob);
  try {
    const a = doc.createElement('a');
    a.href = url;
    a.download = name;
    a.rel = 'noopener';
    a.style.display = 'none';
    doc.body.appendChild(a);
    a.click();
    a.remove();
  } finally {
    setTimeout(() => URL.revokeObjectURL(url), REVOKE_AFTER_MS);
  }
}

const imageExt: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/gif': 'gif',
  'image/webp': 'webp',
  'image/heic': 'heic',
  'image/heif': 'heif',
};

/**
 * 下载时的文件名（console 问题 16）：文件用正文接口（隔离授权）里的文件名；图片消息没有文件名，
 * 用"图片-{seq}.{扩展名}"。去掉路径分隔符和控制字符，空的用 file。
 */
export function downloadName(kind: 'image' | 'file', seq: number, name?: string, mime?: string): string {
  if (kind === 'image') return `图片-${seq}.${imageExt[mime ?? ''] ?? 'img'}`;
  // eslint-disable-next-line no-control-regex
  const clean = (name ?? '').replace(/[\\/\u0000-\u001f\u007f]/g, '_').trim();
  return clean || 'file';
}
