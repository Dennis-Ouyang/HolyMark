/** Markdown 相关的纯函数：切块、纯文本、字数、批注、大纲。与 Rust 端的切块规则保持一致。 */

/** 按空行切块；``` 代码块和 $$ 公式块内部的空行不切。每块带着它后面的空行，拼接可还原原文。 */
export function splitBlocks(text: string): string[] {
  const blocks: string[] = [];
  let cur = "";
  let fence: string | null = null;
  let trailingBlank = false;
  const lines = text.match(/[^\n]*\n|[^\n]+$/g) || [];
  for (const line of lines) {
    const t = line.replace(/\r?\n$/, "");
    const trimmed = t.trimStart();
    const blank = t.trim() === "";
    if (fence === null && !blank && trailingBlank && cur) { blocks.push(cur); cur = ""; }
    cur += line;
    if (fence !== null) {
      if (trimmed.startsWith(fence) && cur.split("\n").length > 2) fence = null;
      trailingBlank = false;
      continue;
    }
    if (trimmed.startsWith("```")) fence = "```";
    else if (trimmed.trim() === "$$") fence = "$$";
    trailingBlank = blank;
  }
  if (cur) blocks.push(cur);
  return blocks;
}

const CJK = /[㐀-鿿豈-﫿]/g;
const PUNCT = /[　-〿！-｠—…“”‘’]/g;

export function countWords(text: string, withPunct: boolean): number {
  const cjk = (text.match(CJK) || []).length;
  const words = (text.replace(CJK, " ").match(/[A-Za-z0-9]+(?:[.'’%-][A-Za-z0-9]+)*/g) || []).length;
  return cjk + words + (withPunct ? (text.match(PUNCT) || []).length : 0);
}

/** 去掉 Markdown 语法后的正文，用于字数统计和搜索。代码、公式、属性区、图表不计入。 */
export function plainText(md: string, frontMatter = true): string {
  const out: string[] = [];
  let skip: string | null = null;
  const lines = md.split("\n");
  let i = 0;
  if (frontMatter && lines[0] === "---") { i = lines.findIndex((l, k) => k > 0 && /^(---|\.\.\.)\s*$/.test(l)) + 1; if (i <= 0) i = 0; }
  for (; i < lines.length; i++) {
    const l = lines[i];
    const t = l.trim();
    if (skip) { if (t.startsWith(skip)) skip = null; continue; }
    if (t.startsWith("```")) { skip = "```"; continue; }
    if (t === "$$") { skip = "$$"; continue; }
    if (/^\$\$.*\$\$$/.test(t)) continue;
    if (/^\|?\s*:?-{3,}/.test(t)) continue;
    out.push(stripInline(l.replace(/^\s*(#{1,6} |> ?|[-*+] \[[ xX]\] |[-*+] |\d+\. )/, "").replace(/\|/g, " ")));
  }
  return out.join("\n");
}

/**
 * 全文字数的增量版本：按块（空行分隔）计数并记住每块的结果，再次调用时只重数改过的块。
 * 每个计数器自带缓存，一个编辑器用一个。
 */
export function wordCounter() {
  let cache = new Map<string, number>();
  return (md: string, withPunct: boolean): number => {
    const next = new Map<string, number>();
    let total = 0;
    splitBlocks(md).forEach((b, i) => {
      const k = (i === 0 ? "F" : "B") + (withPunct ? 1 : 0) + b;
      let n = next.get(k) ?? cache.get(k);
      if (n === undefined) n = countWords(plainText(b, i === 0), withPunct);
      next.set(k, n);
      total += n;
    });
    cache = next;
    return total;
  };
}

export function stripInline(s: string): string {
  return s
    .replace(/\{==([\s\S]*?)==\}\{>>[\s\S]*?<<\}/g, "$1")
    .replace(/!\[([^\]]*)\]\([^)]*\)(\{[^}]*\})?/g, "$1")
    .replace(/\[@[\w:-]+\]/g, "")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/\$[^$\n]+\$/g, "")
    .replace(/(\*\*|__|~~|==|`|\*|\^)/g, "");
}

export interface Note { at: number; length: number; quote: string; who: string; date: string; text: string }
const NOTE_RE = /\{==([\s\S]+?)==\}\{>>([\s\S]*?)<<\}/g;

/** 批注采用 CriticMarkup：{==原文==}{>>@作者 日期：内容<<} */
export function parseNotes(md: string): Note[] {
  const out: Note[] = [];
  let m: RegExpExecArray | null;
  NOTE_RE.lastIndex = 0;
  while ((m = NOTE_RE.exec(md))) {
    const body = m[2].match(/^@(\S+)\s+(\S+?)：([\s\S]*)$/);
    out.push({ at: m.index, length: m[0].length, quote: m[1], who: body ? body[1] : "", date: body ? body[2] : "", text: body ? body[3] : m[2] });
  }
  return out;
}

export interface Heading { level: number; text: string; pos: number; /** 标题末尾写的 {#id} */ attrId?: string }
/** 标题末尾的 Pandoc 属性 {#id .class key=val}：目录里不显示 */
export const HEADING_ATTR = /\s*\{(?=[#.]|[\w-]+=)[^{}]*\}\s*$/;
export function headings(md: string): Heading[] {
  const out: Heading[] = [];
  let pos = 0;
  let fence = false;
  const lines = md.split("\n");
  let start = 0;
  if (lines[0] === "---") { const e = lines.findIndex((l, k) => k > 0 && /^(---|\.\.\.)\s*$/.test(l)); if (e > 0) { for (let k = 0; k <= e; k++) pos += lines[k].length + 1; start = e + 1; } }
  for (let k = start; k < lines.length; k++) {
    const l = lines[k];
    if (l.trim().startsWith("```")) fence = !fence;
    const m = !fence && l.match(/^(#{1,6})\s+(.+)$/);
    if (m) {
      const attr = m[2].match(HEADING_ATTR);
      const id = attr?.[0].match(/#([^\s{}]+)/)?.[1];
      out.push({ level: m[1].length, text: stripInline(attr ? m[2].slice(0, attr.index) : m[2]), pos, ...(id ? { attrId: id } : {}) });
    }
    pos += l.length + 1;
  }
  return out;
}

/** 读取属性区里 holymark: 下面的本文版式 */
export function docLayout(md: string): Record<string, string> {
  const o: Record<string, string> = {};
  if (!md.startsWith("---\n")) return o;
  const end = md.indexOf("\n---", 3);
  if (end < 0) return o;
  let inSec = false;
  for (const l of md.slice(4, end).split("\n")) {
    if (/^holymark:\s*$/.test(l)) { inSec = true; continue; }
    if (inSec && /^\s+[\w-]+:/.test(l)) { const m = l.match(/^\s+([\w-]+):\s*(.*)$/)!; o[m[1]] = m[2].trim(); }
    else if (!/^\s/.test(l)) inSec = false;
  }
  return o;
}

/** 写回本文版式；传空对象则删除 holymark: 段 */
export function setDocLayout(md: string, layout: Record<string, string>): string {
  let fm: string[] = [];
  let body = md;
  if (md.startsWith("---\n")) {
    const end = md.indexOf("\n---", 3);
    if (end >= 0) {
      fm = md.slice(4, end).split("\n");
      body = md.slice(end + 4).replace(/^\n/, "");
    }
  }
  const kept: string[] = [];
  let skip = false;
  for (const l of fm) {
    if (/^holymark:\s*$/.test(l)) { skip = true; continue; }
    if (skip && /^\s/.test(l)) continue;
    skip = false;
    kept.push(l);
  }
  const entries = Object.entries(layout).filter(([, v]) => v !== "");
  if (entries.length) kept.push("holymark:", ...entries.map(([k, v]) => `  ${k}: ${v}`));
  if (!kept.length) return body;
  return `---\n${kept.join("\n")}\n---\n${body}`;
}

/* ---------------- 差异 ---------------- */
export type Op = ["=" | "-" | "+", string];

export function diffChars(a: string, b: string): Op[] {
  const n = a.length, m = b.length;
  if (n * m > 4_000_000) return [["-", a], ["+", b]];
  const dp: Uint32Array[] = [];
  for (let i = 0; i <= n; i++) dp.push(new Uint32Array(m + 1));
  for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
  const ops: Op[] = [];
  const push = (t: Op[0], c: string) => { const l = ops[ops.length - 1]; if (l && l[0] === t) l[1] += c; else ops.push([t, c]); };
  let i = 0, j = 0;
  while (i < n && j < m) { if (a[i] === b[j]) { push("=", a[i]); i++; j++; } else if (dp[i + 1][j] >= dp[i][j + 1]) push("-", a[i++]); else push("+", b[j++]); }
  while (i < n) push("-", a[i++]);
  while (j < m) push("+", b[j++]);
  // 把夹在改动之间的单个相同字并入改动，读起来更连贯
  const out: Op[] = [];
  ops.forEach((o, k) => { if (o[0] === "=" && o[1].length <= 1 && k > 0 && k < ops.length - 1) out.push(["-", o[1]], ["+", o[1]]); else out.push(o); });
  const res: Op[] = [];
  let D = "", I = "";
  const flush = () => { if (D) res.push(["-", D]); if (I) res.push(["+", I]); D = I = ""; };
  out.forEach((o) => { if (o[0] === "=") { flush(); res.push(o); } else if (o[0] === "-") D += o[1]; else I += o[1]; });
  flush();
  return res;
}

export interface Row { left: string | null; right: string | null; ops: Op[] | null }

/** 两个版本按块对齐：相同的块作为锚点，锚点之间的块按顺序两两配对为“修改”，多出来的是新增或删除。 */
export function alignBlocks(oldText: string, newText: string): Row[] {
  const A = splitBlocks(oldText).map((s) => s.replace(/\n+$/, ""));
  const B = splitBlocks(newText).map((s) => s.replace(/\n+$/, ""));
  const n = A.length, m = B.length;
  const dp = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) dp[i][j] = A[i] === B[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
  const rows: Row[] = [];
  let i = 0, j = 0;
  let dels: string[] = [], adds: string[] = [];
  const flush = () => {
    const k = Math.max(dels.length, adds.length);
    for (let x = 0; x < k; x++) {
      const l = dels[x] ?? null, r = adds[x] ?? null;
      rows.push({ left: l, right: r, ops: diffChars(l ?? "", r ?? "") });
    }
    dels = []; adds = [];
  };
  while (i < n && j < m) {
    if (A[i] === B[j]) { flush(); rows.push({ left: A[i], right: B[j], ops: null }); i++; j++; }
    else if (dp[i + 1][j] >= dp[i][j + 1]) dels.push(A[i++]);
    else adds.push(B[j++]);
  }
  while (i < n) dels.push(A[i++]);
  while (j < m) adds.push(B[j++]);
  flush();
  return rows;
}

/** 新文本里相对旧文本新增或改过的行号（从 1 开始），用于改动高亮 */
export function changedLines(oldText: string, newText: string): number[] {
  const A = oldText.split("\n"), B = newText.split("\n");
  // 去掉首尾相同的部分，中间做 LCS，行数多时直接整段算作改动
  let s = 0;
  while (s < A.length && s < B.length && A[s] === B[s]) s++;
  let ea = A.length - 1, eb = B.length - 1;
  while (ea >= s && eb >= s && A[ea] === B[eb]) { ea--; eb--; }
  const a = A.slice(s, ea + 1), b = B.slice(s, eb + 1);
  if (a.length * b.length > 1_000_000) return b.map((_, i) => s + i + 1);
  const dp = Array.from({ length: a.length + 1 }, () => new Uint32Array(b.length + 1));
  for (let i = a.length - 1; i >= 0; i--) for (let j = b.length - 1; j >= 0; j--) dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
  const out: number[] = [];
  let i = 0, j = 0;
  while (j < b.length) {
    if (i < a.length && a[i] === b[j]) { i++; j++; }
    else if (i < a.length && dp[i + 1][j] >= dp[i][j + 1]) i++;
    else { if (b[j].trim()) out.push(s + j + 1); j++; }
  }
  return out;
}
