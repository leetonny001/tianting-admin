import { textForCode } from '../api/errors';
import type { BatchResult, RowError, ValidateResult } from '../api/types';
import { Text } from './ui';

/** 拆批结果："已成功 N 批 / 共 M 批"。im-server 每批原子、批之间不原子，所以要说明可以整文件重新提交。 */
export function BatchOutcome({ result }: { result: BatchResult }) {
  if (!result.failedCode) {
    return (
      <p className="note note-ok" role="status">
        全部完成：已成功 {result.succeededBatches} 批 / 共 {result.totalBatches} 批
      </p>
    );
  }
  return (
    <p className="note note-error" role="alert">
      已成功 {result.succeededBatches} 批 / 共 {result.totalBatches} 批。
      {textForCode(result.failedCode, result.failedMsg)}。后面的批次没有执行，修正后可以整个文件重新提交。
    </p>
  );
}

export function ValidationErrors({ errors, total }: { errors: RowError[]; total: number }) {
  return (
    <div className="note note-error" role="alert">
      <p>
        有 {total} 处错误，修正后重新上传{total > errors.length ? `（只显示前 ${errors.length} 条）` : ''}：
      </p>
      <ul>
        {errors.map((e) => (
          <li key={`${e.line}-${e.code}`}>
            第 {e.line} 行：{lineText(e)}
          </li>
        ))}
      </ul>
    </div>
  );
}

function lineText(e: RowError): string {
  if (e.code === 4004) return 'userId 格式不正确';
  if (e.msg.includes('nickname')) return '昵称超过 32 个字符';
  if (e.msg.includes('avatar')) return '头像地址超过 512 个字符';
  if (e.msg.includes('remark')) return '备注超过 32 个字符';
  if (e.msg.includes('different')) return '两个用户不能相同';
  if (e.msg.includes('columns')) return '列数不对';
  return '这一行不合法';
}

export function Preview({ result, columns }: { result: ValidateResult; columns: [string, string][] }) {
  return (
    <>
      <p>
        校验通过，共 {result.total} 行。前 {result.preview?.length ?? 0} 行预览：
      </p>
      <table>
        <thead>
          <tr>
            {columns.map(([, label]) => (
              <th key={label}>{label}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {result.preview?.map((row, i) => (
            <tr key={i}>
              {columns.map(([k]) => (
                <td key={k}>
                  <Text>{row[k]}</Text>
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </>
  );
}
