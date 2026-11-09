export interface SessionInfo {
  account: { id: string; username: string; displayName: string; space: string };
  roles: string[];
  perms: string[];
  state: 'setup' | 'full';
  csrfToken: string;
  recoveryCodesLeft?: number;
  recoveryCodes?: string[];
}

export interface AccountRow {
  id: string;
  username: string;
  displayName: string;
  status: string;
  roles: string[];
  createdAt: number;
  activatedAt: number;
  locked: boolean;
}

export interface UserRow {
  userId: string;
  nickname?: string;
  avatar?: string;
  createdAt?: number;
  official: boolean;
  online: boolean;
  /** 第二批：im-server 的值，过期的已经是 null。 */
  ban?: { until: number | null; reason: string; by: string; at: number } | null;
  /** 没有这个键 = 没有禁言；null = 永久。 */
  mutedUntil?: number | null;
  /** 账号信息（F-ACC-09 规则 5）。这里的 createdAt 才是注册时间，上面的 createdAt 是资料时间。取不到时是 null，同时 accountUnavailable=true。 */
  account?: AccountInfo | null;
  accountUnavailable?: boolean;
}

export interface AccountInfo {
  hasAccount: boolean;
  createdAt?: number;
  lastLoginAt?: number;
  sessions: number;
}

/** 邀请码列表的一项：没有明文。 */
export interface InviteRow {
  inviteId: string;
  codeLast4: string;
  maxUses: number;
  usedCount: number;
  expiresAt: number;
  note?: string;
  createdBy?: string;
  createdAt: number;
  disabledAt?: number;
  autoDisabled?: boolean;
}

/** 生成响应的一项：明文只在这里出现一次。 */
export interface CreatedInvite extends InviteRow {
  code: string;
}

export interface GroupRow {
  groupId: string;
  name: string;
  type: string;
  owner: string | null;
  memberCount: number;
  historyVisible: boolean;
  createdAt: number;
  dissolvedAt?: number;
}

export interface GroupDetail {
  groupId: string;
  name: string;
  historyVisible: boolean;
  createdAt: number;
  memberCount: number;
  owner: string | null;
  admins?: string[];
  notice?: string;
  managed: boolean;
  /** 全群禁言（F-ADM-42）：只用 im-server 返回的值，页面不自己记。 */
  allMuted?: boolean;
}

/** 用户所在群的一项（F-ADM-10 规则 2）。 */
export interface UserGroupRow {
  groupId: string;
  name: string;
  type: string;
  memberCount: number;
  role: string;
  joinedAt: number;
}

/** 用户会话列表的一项（F-ADM-30 规则 1 ③）：只有这三个字段，没有正文和摘要。 */
export interface UserConvRow {
  convId: string;
  type: string;
  updatedAt: number;
}

export interface MemberRow {
  userId: string;
  role: string;
  joinedAt: number;
  mutedUntil?: number | null;
}

export interface FriendRow {
  userId: string;
  source: string;
  createdAt: number;
}

export interface MessageMeta {
  seq: number;
  msgId: string;
  from: string;
  type: string;
  bodyLength: number;
  ts: number;
  deleted?: boolean;
  deletedAt?: number;
  deletedBy?: string;
}

/** 正文页的一条消息（只在 MessageBody 页面用）。 */
export interface BodyMessage {
  seq: number;
  msgId: string;
  from: string;
  type: string;
  ts: number;
  /** image、file（PRD-chat 第 14.1 节）：正文授权下有文件名；文件内容不放开，后台不内联渲染。 */
  body?: {
    text?: string;
    data?: unknown;
    image?: { fileId?: string; width?: number; height?: number; size?: number; mime?: string; expired?: boolean };
    file?: { fileId?: string; name?: string; size?: number; mime?: string; expired?: boolean };
  };
  deleted?: boolean;
  deletedAt?: number;
  deletedBy?: string;
}

export interface BodyPage {
  messages: BodyMessage[];
  hasMore: boolean;
  grantPrefix: string;
  expiresAt: number;
}

export interface SessionRow {
  connId: string;
  platform: string;
  connectedAt: number;
  node: string;
  ip: string;
  queueLen?: number;
}

export interface AuditRecord {
  seq: number;
  id: string;
  ts: number;
  space: string;
  phase: 'intent' | 'result' | 'event';
  requestId: string;
  accountId: string;
  username: string;
  roles: string[];
  actor: string;
  ip: string;
  ua: string;
  action: string;
  target: { type?: string; ids?: string[]; count?: number };
  params: Record<string, unknown>;
  reason: string;
  ticket: string;
  result: string;
  code: number;
  resultMissing?: boolean;
}

export interface NotificationRow {
  id: string;
  kind: string;
  payload: Record<string, unknown>;
  createdAt: number;
  read: boolean;
}

export interface BatchResult {
  succeededBatches: number;
  totalBatches: number;
  failedCode?: number;
  failedMsg?: string;
}

export interface RowError {
  line: number;
  code: number;
  msg: string;
}

export interface ValidateResult {
  valid: boolean;
  total: number;
  errors?: RowError[];
  errorCount?: number;
  importToken?: string;
  fileSha256?: string;
  preview?: Record<string, string>[];
}

export interface PushSchema {
  type?: string | string[];
  title?: string;
  description?: string;
  properties?: Record<string, PushSchema>;
  required?: string[];
  enum?: (string | number | boolean | null)[];
  maxLength?: number;
  minimum?: number;
  maximum?: number;
}

export interface PushTemplate {
  type: string;
  title: string;
  schema: PushSchema;
}

export interface PushPreview {
  target: 'user' | 'all';
  targetCount: number;
  type: string;
  dataLength: number;
  data: string;
}

export interface PushDraft {
  id: string;
  type: string;
  dataPretty: string;
  reason: string;
  createdBy: string;
  createdByName: string;
  createdAt: number;
  expiresAt: number;
  status: 'pending' | 'expired' | 'approved';
  approvedByName?: string;
  approvedAt?: number;
  sendStatus?: string;
}

export interface PushRecord {
  id: string;
  kind: 'user' | 'all';
  type: string;
  dataPretty: string;
  dataSha256: string;
  userIds: string[];
  targetCount: number;
  reason: string;
  ticket?: string;
  createdByName: string;
  approvedByName?: string;
  sentAt: number;
  pushId: string;
  status: string;
  errorCode?: number;
  created?: boolean;
  replayedAt?: number;
  replayCreated?: boolean;
  replayExpired?: boolean;
}
