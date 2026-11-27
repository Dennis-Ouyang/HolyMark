/** N9 在整个文件夹里查找替换（纯函数）：找出匹配、算出替换后的文字、只应用勾选的那几处。 */

export interface FindOptions {
  caseSensitive: boolean;
  wholeWord: boolean;
  regex: boolean;
  /** 跳过代码块、行内代码和链接 / 图片的地址（默认开；改了地址链接就断了） */
  skipCode: boolean;
}
export const FIND_DEFAULTS: FindOptions = { caseSensitive: false, wholeWord: false, regex: false, skipCode: true };

export interface Match { from: number; to: number; text: string; replacement: string }

const escRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** 搜索用的正则；写错了返回错误信息 */
export function buildRegex(query: string, o: FindOptions): RegExp | string {
  if (!query) return "";
  let src = o.regex ? query : escRe(query);
  // 全词：前后不能紧挨着英文字母、数字或下划线（中文没有「词」的边界，照常匹配）
  if (o.wholeWord) src = `(?<![A-Za-z0-9_])(?:${src})(?![A-Za-z0-9_])`;
  try { return new RegExp(src, "gu" + (o.caseSensitive ? "" : "i")); } catch (e) { return String((e as Error).message || e); }
}

/** 代码块、行内代码、链接和图片地址的位置 */
export function codeRanges(text: string): [number, number][] {
  const out: [number, number][] = [];
  const fence = /^(`{3,}|~{3,})[^\n]*\n[\s\S]*?(?:^\1[ \t]*$|(?![\s\S]))/gm;
  for (const m of text.matchAll(fence)) out.push([m.index!, m.index! + m[0].length]);
  const inFence = (p: number) => out.some(([a, z]) => p >= a && p < z);
  for (const m of text.matchAll(/(`+)[^`\n]+?\1/g)) if (!inFence(m.index!)) out.push([m.index!, m.index! + m[0].length]);
  for (const m of text.matchAll(/\]\((<[^>\n]*>|[^)\s]*)(?:\s+"[^"\n]*")?\)/g)) if (!inFence(m.index!)) out.push([m.index!, m.index! + m[0].length]);
  return out;
}

/** 正则替换的写法：$& 整个匹配、$1…$99 分组、$<名字> 命名分组、$$ 美元符号 */
export function expandReplacement(repl: string, m: RegExpExecArray): string {
  return repl.replace(/\$(\$|&|\d{1,2}|<[^>]+>)/g, (all, k: string) => {
    if (k === "$") return "$";
    if (k === "&") return m[0];
    if (k.startsWith("<")) return m.groups?.[k.slice(1, -1)] ?? "";
    const n = +k;
    return n > 0 && n < m.length ? m[n] ?? "" : all;
  });
}

export function findMatches(text: string, query: string, replacement: string, o: FindOptions, max = 5000): Match[] {
  const re = buildRegex(query, o);
  if (typeof re === "string") return [];
  const code = o.skipCode ? codeRanges(text) : [];
  const out: Match[] = [];
  re.lastIndex = 0;
  for (let m: RegExpExecArray | null; (m = re.exec(text)); ) {
    if (!m[0].length) { re.lastIndex++; continue; }
    const from = m.index, to = from + m[0].length;
    if (code.some(([a, z]) => from < z && to > a)) continue;
    out.push({ from, to, text: m[0], replacement: o.regex ? expandReplacement(replacement, m) : replacement });
    if (out.length >= max) break;
  }
  return out;
}

/** 只应用勾选的那几处（matches 按位置排好、互不重叠） */
export function applyMatches(text: string, matches: Match[]): string {
  let out = "", last = 0;
  for (const m of [...matches].sort((a, b) => a.from - b.from)) {
    if (m.from < last) continue;
    out += text.slice(last, m.from) + m.replacement;
    last = m.to;
  }
  return out + text.slice(last);
}

/** 结果列表里一处匹配前后的文字（同一行里，各留一点） */
export function context(text: string, m: Match, span = 18): { pre: string; post: string } {
  const ls = text.lastIndexOf("\n", m.from - 1) + 1;
  let le = text.indexOf("\n", m.to);
  if (le < 0) le = text.length;
  const a = Math.max(ls, m.from - span), z = Math.min(le, m.to + span);
  return { pre: (a > ls ? "…" : "") + text.slice(a, m.from), post: text.slice(m.to, z) + (z < le ? "…" : "") };
}
