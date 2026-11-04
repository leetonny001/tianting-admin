// 夹具：故意违规。scripts/check-lint-rules.mjs 断言 ESLint 会拒绝它（AC-CON-10-6）。
export function Bad({ html }: { html: string }) {
  return <div dangerouslySetInnerHTML={{ __html: html }} />;
}
