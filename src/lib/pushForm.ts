import type { PushSchema } from '../api/types';

// 模板表单（FE-424）：模板的 JSON Schema 渲染成字段。这里只做填写时的提示，校验以 console-server 为准。

export type FieldKind = 'text' | 'textarea' | 'number' | 'integer' | 'boolean' | 'select' | 'json';

function typeOf(schema: PushSchema): string {
  const list = [schema.type ?? 'string'].flat();
  return list.find((t) => t !== 'null') ?? 'string';
}

export function fieldKind(schema: PushSchema): FieldKind {
  if (schema.enum) return 'select';
  switch (typeOf(schema)) {
    case 'string':
      return schema.maxLength !== undefined && schema.maxLength <= 200 ? 'text' : 'textarea';
    case 'integer':
      return 'integer';
    case 'number':
      return 'number';
    case 'boolean':
      return 'boolean';
    default:
      return 'json'; // 嵌套对象、数组：直接填 JSON
  }
}

export type FormValues = Record<string, string | boolean>;

export interface BuildResult {
  data: Record<string, unknown>;
  errors: Record<string, string>;
}

/** 表单值 → data。没填的可选字段不出现在 data 里。 */
export function buildData(schema: PushSchema, values: FormValues): BuildResult {
  const data: Record<string, unknown> = {};
  const errors: Record<string, string> = {};
  const required = schema.required ?? [];
  for (const [name, field] of Object.entries(schema.properties ?? {})) {
    const kind = fieldKind(field);
    const raw = values[name];
    if (kind === 'boolean') {
      if (raw !== undefined) data[name] = raw === true;
      else if (required.includes(name)) data[name] = false;
      continue;
    }
    const text = typeof raw === 'string' ? raw : '';
    if (text === '') {
      if (required.includes(name)) errors[name] = '必填';
      continue;
    }
    switch (kind) {
      case 'integer':
      case 'number': {
        const n = Number(text);
        if (!Number.isFinite(n) || (kind === 'integer' && !Number.isInteger(n))) errors[name] = '需要填数字';
        else if (kind === 'integer' && !Number.isSafeInteger(n)) errors[name] = '数字太大';
        else data[name] = n;
        break;
      }
      case 'select': {
        const option = field.enum?.find((v) => String(v) === text);
        if (option === undefined) errors[name] = '请选择';
        else data[name] = option;
        break;
      }
      case 'json':
        try {
          data[name] = JSON.parse(text);
        } catch {
          errors[name] = '需要是合法的 JSON';
        }
        break;
      default:
        data[name] = text;
    }
  }
  return { data, errors };
}
