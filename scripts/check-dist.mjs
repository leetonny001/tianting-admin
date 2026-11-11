// 构建产物扫描（AC-CON-10-1 前端部分）：不含 IM 密钥和管理接口相关的字符串，没有 source map。
// 测试环境的密钥来自 e2e/stack.mjs，用可识别的固定值，这里一起查。
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

const bad = [
  'X-Admin-Key',
  'X-IM-Signature',
  'X-IM-Caller',
  'CON_IM_SIGNING_KEY',
  'IM_ADMIN',
  '/admin/users',
  '/admin/groups',
  'tianting-e2e-signing-seed',
  'tianting-e2e-legacy-key',
  'tianting-admin-e2e-quarantine-key',
  'fake-report-key-for-admin-e2e',
  'ZmFrZS1yZXBvcnQta2V5LWZvci1hZG1pbi1lMmUhISE',
  '/admin/files',
];
const problems = [];
const walk = (dir) => {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) {
      walk(p);
      continue;
    }
    if (name.endsWith('.map')) problems.push(`source map shipped: ${p}`);
    const text = readFileSync(p, 'latin1');
    for (const s of bad) if (text.includes(s)) problems.push(`${p} contains "${s}"`);
  }
};
walk('dist');
const html = readFileSync('dist/index.html', 'utf8');
if (/<script(?![^>]*\bsrc=)[^>]*>/.test(html)) problems.push('index.html has an inline script: CSP would block it');
if (problems.length) {
  console.error(problems.join('\n'));
  process.exit(1);
}
console.log('dist: no secrets, no admin API strings, no source maps, no inline scripts');
