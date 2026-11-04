// AC-CON-10-6：用违规夹具验证规则真的生效，防止配置被改坏后 lint 静默通过。
import { spawnSync } from 'node:child_process';

const r = spawnSync(
  'npx',
  ['eslint', '--no-ignore', '--no-warn-ignored', '--rule', '{}', 'lint-fixtures/violation.tsx'],
  { encoding: 'utf8' },
);
if (r.status === 0 || !r.stdout.includes('dangerouslySetInnerHTML')) {
  console.error('ESLint did not reject lint-fixtures/violation.tsx:\n' + r.stdout + r.stderr);
  process.exit(1);
}
console.log('lint rules: dangerouslySetInnerHTML is rejected');
