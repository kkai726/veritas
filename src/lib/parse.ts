export class ParseError extends Error {}

function stripFence(raw: string): string {
  let text = raw.trim();
  const fence = text.match(/```(?:json|JSON)?\s*([\s\S]*?)```/);
  if (fence) text = fence[1].trim();
  return text;
}

function sliceObject(text: string): string {
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start === -1 || end === -1 || end <= start) return text;
  return text.slice(start, end + 1);
}

/** 常见小毛病修复：尾逗号、BOM、注释、全角引号。 */
function repair(text: string): string {
  return sliceObject(text)
    .replace(/^\uFEFF/, '')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/[^\n\r]*/g, '$1')
    .replace(/,\s*([}\]])/g, '$1')
    .replace(/[\u201c\u201d]/g, '"')
    .trim();
}

export function extractJson(raw: string): any {
  const base = sliceObject(stripFence(raw));
  const attempts = [base, repair(base)];

  for (const candidate of attempts) {
    try {
      return JSON.parse(candidate);
    } catch {
      /* 继续尝试下一种修复 */
    }
  }

  // 逐字符定位：截取第一个可被完整解析的对象
  for (let end = base.lastIndexOf('}'); end > 0; end = base.lastIndexOf('}', end - 1)) {
    const candidate = base.slice(0, end + 1);
    try {
      return JSON.parse(candidate);
    } catch {
      /* 继续收缩 */
    }
  }

  throw new ParseError('模型输出不是合法 JSON，无法解析核查结果。');
}

export function looksLikeJson(raw: string): boolean {
  return /\{[\s\S]*\}/.test(raw);
}
