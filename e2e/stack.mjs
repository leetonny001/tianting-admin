// 端到端环境：真实的 Postgres + im-server（测试模式）+ console-server（测试模式，托管 dist/，响应头就是生产的 CSP）。
// 由 Playwright 的 webServer 启动，结束时清理。源码默认在同级目录，可以用环境变量改。
import { execFileSync, spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { existsSync, mkdtempSync, writeFileSync } from 'node:fs';
import { connect } from 'node:net';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import pg from 'pg';

const imDir = resolve(
  process.env.TIANTING_SERVER_DIR ??
    (existsSync('../tianting-server/server') ? '../tianting-server/server' : '../im-mvp/server'),
);
const consoleDir = resolve(process.env.TIANTING_CONSOLE_DIR ?? '../tianting-console-server');
const adminUrl = process.env.CON_TEST_ADMIN_URL ?? 'postgres://127.0.0.1:5432/postgres?sslmode=disable';
const work = mkdtempSync(join(tmpdir(), 'tt-admin-e2e-'));
// im-server 的端口可以换：tianting-ios 的测试环境也用 18180、18181。
const ports = {
  console: 18190,
  ops: 18191,
  ws: Number(process.env.E2E_IM_WS_PORT ?? 18180),
  imAdmin: Number(process.env.E2E_IM_ADMIN_PORT ?? 18181),
  // 假 S3（e2e/fake_s3.py）：im-server 打开图片和文件（C2）要对象存储。后台页面本身不连它。
  s3: Number(process.env.E2E_S3_PORT ?? 18192),
};
// 可识别的固定测试密钥：scripts/check-dist.mjs 和 HAR 扫描都查它们。
const seed = Buffer.from('tianting-e2e-signing-seed-32byte');
const legacy = 'tianting-e2e-legacy-key';
const reportKey = 'fake-report-key-for-admin-e2e!!!';

// 端口被别的进程占着时直接失败：否则测试可能连到别人的服务，只看到难懂的 401。
async function assertPortsFree(list) {
  const busy = await Promise.all(
    list.map(
      (port) =>
        new Promise((done) => {
          const s = connect({ host: '127.0.0.1', port });
          s.setTimeout(1000, () => (s.destroy(), done(null)));
          s.once('connect', () => (s.destroy(), done(port)));
          s.once('error', () => done(null));
        }),
    ),
  );
  const taken = busy.filter(Boolean);
  if (taken.length > 0) {
    console.error(`e2e ports already in use: ${taken.join(', ')}`);
    process.exit(1);
  }
}
await assertPortsFree([ports.console, ports.ops, ports.ws, ports.imAdmin, ports.s3]);

const go = (dir, out, pkg) => execFileSync('go', ['build', '-o', join(work, out), pkg], { cwd: dir, stdio: 'inherit' });
go(imDir, 'im-server', './cmd/im-server');
go(consoleDir, 'console-server', './cmd/console-server');

const publicKeyOf = (s) =>
  execFileSync('node', [
    '-e',
    `
  const c=require('crypto');
  const k=c.createPrivateKey({key:Buffer.concat([Buffer.from('302e020100300506032b657004220420','hex'),Buffer.from('${s.toString('hex')}','hex')]),format:'der',type:'pkcs8'});
  process.stdout.write(c.createPublicKey(k).export({format:'der',type:'spki'}).subarray(12).toString('base64'));
`,
  ]).toString();
const pub = publicKeyOf(seed);
const msgReadSeed = Buffer.from('tianting-e2e-msgread-seed-32byte');
const msgReadPub = publicKeyOf(msgReadSeed);
const callers = join(work, 'callers.json');
writeFileSync(
  callers,
  JSON.stringify([
    {
      id: 'console',
      alg: 'ed25519',
      publicKey: pub,
      scopes: [
        'user.read',
        'user.write',
        'user.kick',
        'user.sessions',
        'token.issue',
        'group.read',
        'group.write',
        'group.dissolve',
        'msg.meta',
        'audit.read',
        'social.settings',
        'social.friends',
        'user.ban',
        'msg.delete',
        'mute.write',
        'push.user',
        'push.all',
        'stats.read',
        'account.invite',
        // 词库和举报（PRD-chat C6，第 14.1 节）。
        'moderation.words',
        'report.read',
        'report.handle',
      ],
      // 持有 push.all 必须配，和 CON_PUSH_TEMPLATES 的 type 一致（PRD-live F-PUSH-09 规则 3）。
      pushTypes: ['notice', 'activity'],
    },
    // 正文走单独的凭证（PRD-admin F-KEY-02 规则 3）。
    {
      id: 'console-msgread',
      alg: 'ed25519',
      publicKey: msgReadPub,
      bodyAccess: true,
      scopes: ['msg.body.group', 'msg.body.c2c', 'msg.quarantine', 'report.evidence'],
    },
  ]),
  { mode: 0o600 },
);

const dbName = 'tt_admin_e2e_' + randomBytes(4).toString('hex');
const admin = new pg.Client({ connectionString: adminUrl });
await admin.connect();
await admin.query(`CREATE DATABASE ${dbName}`);
await admin.query('ALTER ROLE console_app LOGIN').catch(() => undefined);
const withDb = (user) => {
  const u = new URL(adminUrl);
  u.pathname = '/' + dbName;
  if (user) u.username = user;
  return u.toString();
};
const origin = `http://127.0.0.1:${ports.console}`;
const consoleEnv = {
  ...process.env,
  CON_OWNER_DATABASE_URL: withDb(),
  CON_DATABASE_URL: withDb('console_app'),
  CON_TEST_MODE: '1',
  CON_TEST_DISABLE_LOCKOUT: '1',
  CON_SPACES: 'admin',
  CON_ADMIN_ADDR: `127.0.0.1:${ports.console}`,
  CON_ADMIN_ORIGIN: origin,
  CON_ADMIN_WEB_DIR: resolve('dist'),
  CON_METRICS_ADDR: 'off',
  CON_ARGON_MEMORY_KIB: '1024',
  CON_ARGON_TIME: '1',
  CON_DATA_KEYS: 'k1:' + Buffer.alloc(32, 'd').toString('base64'),
  CON_HASH_PEPPER: Buffer.alloc(32, 'p').toString('base64'),
  CON_IM_ADMIN_URL: `http://127.0.0.1:${ports.imAdmin}`,
  CON_IM_SIGNING_KEY: seed.toString('base64'),
  CON_IM_MSGREAD_KEY: msgReadSeed.toString('base64'),
  CON_PUSH_TEMPLATES: join(consoleDir, 'deploy/push-templates.example.json'),
};
execFileSync(join(work, 'console-server'), ['migrate', 'up'], { env: consoleEnv, stdio: 'inherit' });
await admin.query('ALTER ROLE console_app LOGIN').catch(() => undefined);
const code = execFileSync(
  join(work, 'console-server'),
  ['account', 'bootstrap', '--space', 'admin', '--username', 'root1'],
  { env: consoleEnv },
)
  .toString()
  .trim()
  .split(': ')
  .pop();
writeFileSync(
  new URL('./.state.json', import.meta.url),
  JSON.stringify({
    origin,
    rootCode: code,
    imAdmin: `http://127.0.0.1:${ports.imAdmin}`,
    ws: `127.0.0.1:${ports.ws}`,
    s3: `http://127.0.0.1:${ports.s3}`,
    legacy,
    clock: Date.now(),
  }),
);

const s3 = `http://127.0.0.1:${ports.s3}`;
const procs = [
  spawn('python3', ['-I', resolve('e2e/fake_s3.py'), '--port', String(ports.s3)], { stdio: 'inherit' }),
  spawn(join(work, 'im-server'), [], {
    stdio: 'inherit',
    env: {
      ...process.env,
      IM_ADDR: `127.0.0.1:${ports.ws}`,
      IM_ADMIN_ADDR: `127.0.0.1:${ports.imAdmin}`,
      IM_METRICS_ADDR: 'off',
      IM_PPROF_ADDR: 'off',
      IM_OPS_ADDR: 'off',
      IM_DB: join(work, 'im.db'),
      IM_TEST_MODE: '1',
      IM_ADMIN_KEY: legacy,
      IM_ADMIN_CALLERS: callers,
      IM_V13_ADMIN_FEATURES: '1',
      // 撤回、引用、@（PRD-chat C4，FE-671）：撤回的原文加密进隔离区，密钥没有开发默认值；这里是可识别的测试值。
      IM_MSG_ACTIONS_ENABLED: '1',
      IM_QUARANTINE_KEY: 'tianting-admin-e2e-quarantine-key-0123456789',
      // 敏感词和举报（PRD-chat C6，FE-696、FE-697）：证据密钥没有开发默认值；这里是一眼能看出是假的 32 字节（base64）。
      // 词库里只放特征词 ZXQ-*。单聊正文开关保持默认 off。
      IM_MOD_ENABLED: '1',
      IM_REPORT_KEY: Buffer.from(reportKey).toString('base64'),
      IM_PUSH_ENABLED: '1',
      // 邀请码用例要真实注册；每次注册用一个来源 IP（X-Forwarded-For），不碰每 IP 每小时 20 次的限流。
      IM_REGISTER_MODE: 'invite',
      IM_TRUSTED_PROXIES: '127.0.0.1/32,::1/128',
      // 图片和文件（PRD-chat C2，FE-639）：对象存储是上面的假 S3；凭证只是占位。
      IM_FILES_ENABLED: '1',
      IM_OBJSTORE_ENDPOINT: s3,
      IM_OBJSTORE_REGION: 'us-east-1',
      IM_OBJSTORE_BUCKET: 'chat',
      IM_OBJSTORE_PUBLIC_BUCKET: 'avatars',
      IM_OBJSTORE_PUBLIC_BASE_URL: `${s3}/avatars`,
      IM_OBJSTORE_ACCESS_KEY: 'admin-e2e-fake-s3',
      IM_OBJSTORE_SECRET_KEY: 'admin-e2e-fake-s3-not-a-secret',
    },
  }),
  spawn(join(work, 'console-server'), [], { stdio: 'inherit', env: consoleEnv }),
];

let closing = false;
const stop = async () => {
  if (closing) return;
  closing = true;
  for (const p of procs) p.kill('SIGKILL');
  await admin.query(`DROP DATABASE IF EXISTS ${dbName} WITH (FORCE)`).catch(() => undefined);
  await admin.end().catch(() => undefined);
  process.exit(0);
};
process.on('SIGTERM', stop);
process.on('SIGINT', stop);
for (const p of procs) p.on('exit', (c) => !closing && (console.error('a server exited', c), stop()));
