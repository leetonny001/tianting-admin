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
}

export interface MemberRow {
  userId: string;
  role: string;
  joinedAt: number;
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
