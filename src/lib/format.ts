const dateTime = new Intl.DateTimeFormat('zh-CN', {
  timeZone: 'Asia/Shanghai',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hour12: false,
});

export function formatTime(ms?: number | null): string {
  if (!ms) return '—';
  return dateTime.format(new Date(ms));
}

/** 和服务端相同的理由规则，前端先挡一次。 */
export function reasonValid(raw: string): boolean {
  const chars = [...raw.trim()];
  return chars.length >= 4 && chars.length <= 200 && chars.some((c) => c !== chars[0]);
}

export const idPattern = /^[A-Za-z0-9_-]{1,64}$/;

/** 粘贴的一批 ID：按空白、逗号分隔，去重。 */
export function parseIds(text: string): string[] {
  return [...new Set(text.split(/[\s,，]+/).filter(Boolean))];
}

export function validConvId(s: string): boolean {
  const parts = s.split(':');
  if (parts.length === 3 && parts[0] === 'c2c') {
    return idPattern.test(parts[1]!) && idPattern.test(parts[2]!) && parts[1]! <= parts[2]!;
  }
  return parts.length === 2 && (parts[0] === 'group' || parts[0] === 'room') && idPattern.test(parts[1]!);
}

export const roleNames: Record<string, string> = {
  super_admin: '超级管理员',
  operator: '运营',
  support: '客服',
  moderator: '内容审核',
  auditor: '审计员',
};

export const actionNames: Record<string, string> = {
  'user.kick': '强制下线',
  'user.sessions.query': '查看在线设备',
  'user.import': '导入用户',
  'user.official.set': '设为官方账号',
  'user.official.unset': '取消官方账号',
  'friend.import': '导入好友',
  'friend.delete': '删除好友',
  'social.settings': '修改社交配置',
  'group.create': '建群',
  'group.update': '修改群设置',
  'group.members.add': '加群成员',
  'group.members.remove': '移除群成员',
  'group.owner.set': '指定群主',
  'group.owner.unset': '收回群主',
  'group.dissolve': '解散群',
  'msg.meta.query': '查询消息元数据',
  'audit.query': '查询审计',
  'audit.verify': '校验审计链',
  'audit.archive': '归档审计',
  'auth.login': '登录',
  'auth.logout': '退出登录',
  'auth.lockout': '账号锁定',
  'auth.step_up': '二次验证',
  'auth.activate': '激活',
  'auth.totp_bound': '绑定动态码',
  'auth.recovery_code_used': '使用恢复码',
  'auth.recovery_codes_regenerated': '重新生成恢复码',
  'account.create': '新建账号',
  'account.roles': '修改角色',
  'account.disable': '停用账号',
  'account.enable': '启用账号',
  'account.reset': '重置账号',
  'account.unlock': '解锁账号',
  'account.emergency_grant': '应急授权',
  'account.bootstrap': '创建首个超管',
};

export const resultNames: Record<string, string> = {
  success: '成功',
  failure: '失败',
  denied: '被拒绝',
  unknown: '结果未知',
};

export const notificationNames: Record<string, string> = {
  'account.activated': '账号已激活',
  'account.reset': '账号被重置',
  'account.locked': '账号被锁定',
  'auth.recovery_code_used': '恢复码被使用',
  'auth.recovery_codes_low': '恢复码快用完了',
  'account.sensitive_role': '授予了敏感角色',
  'account.emergency_grant': '应急授权',
  'audit.verify_failed': '审计校验失败',
  'audit.anchor_failed': '审计锚定失败',
};
