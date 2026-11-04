import js from '@eslint/js';
import reactHooks from 'eslint-plugin-react-hooks';
import tseslint from 'typescript-eslint';

// 用户可控内容（昵称、群名、理由……）一律按纯文本渲染（PRD-admin F-CON-10 规则 2）。
export const xssRules = [
  {
    selector: "JSXAttribute[name.name='dangerouslySetInnerHTML']",
    message: '禁止 dangerouslySetInnerHTML：一律用 <Text>',
  },
  { selector: "MemberExpression[property.name='innerHTML']", message: '禁止 innerHTML' },
  { selector: "MemberExpression[property.name='outerHTML']", message: '禁止 outerHTML' },
  { selector: "CallExpression[callee.property.name='insertAdjacentHTML']", message: '禁止 insertAdjacentHTML' },
  // CSP 不允许内联样式属性，样式全部写在 CSS 文件里。
  { selector: "JSXAttribute[name.name='style']", message: '禁止 style 属性：CSP 不允许，写到 src/app.css' },
];

export default tseslint.config(
  { ignores: ['dist', 'playwright-report', 'test-results', 'lint-fixtures'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    plugins: { 'react-hooks': reactHooks },
    rules: {
      ...reactHooks.configs.recommended.rules,
      // 这个后台到处是"进入页面就加载数据"，effect 里发请求是预期写法，规则把 fetch 回调里的 setState 也算进去了。
      'react-hooks/set-state-in-effect': 'off',
      'no-restricted-syntax': ['error', ...xssRules],
      // 会话凭证不进本地存储（AC-CON-05-2）；这个应用也没有别的东西要存。
      'no-restricted-globals': [
        'error',
        { name: 'localStorage', message: '后台不用本地存储' },
        { name: 'sessionStorage', message: '后台不用本地存储' },
      ],
    },
  },
  {
    // 端到端测试要断言本地存储里没有东西。
    files: ['e2e/**/*.ts'],
    rules: { 'no-restricted-globals': 'off' },
  },
  {
    files: ['scripts/**/*.mjs', 'e2e/**/*.mjs'],
    languageOptions: { globals: { process: 'readonly', console: 'readonly', URL: 'readonly', Buffer: 'readonly' } },
  },
);
