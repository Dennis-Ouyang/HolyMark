/**
 * 中文排版整理（纯函数）：输入文本和规则，输出整理后的文本、改动列表和每条规则改了几处。
 *
 * - 只由用户主动触发，打字时不调用。
 * - 永远跳过：代码块、行内代码、公式、属性区、链接和图片的地址、文献引用 [@key]、批注的标记符号、HTML、
 *   网址、路径、转义字符、Pandoc 属性 {#id}、表格分隔行、分隔线、行首的标题 / 列表 / 引用标记。
 * - 所有改动都不跨行（不增删换行），所以最后可以逐行比出最小的改动，交给编辑器一次事务完成。
 */

export interface TidyRules {
  /** 中文和英文、数字之间的空格 */
  space: "off" | "add" | "remove";
  /** 中文语境里的半角标点转全角 */
  punct: boolean;
  /** 引号统一成「」或“” */
  quotes: "off" | "corner" | "curly";
  /** ... 和 。。。 转成 ……，-- 转成 —— */
  dash: boolean;
  /** 全角字母、数字转半角 */
  fullwidth: boolean;
  /** 清理连续空格、行末空格 */
  spaces: boolean;
  /** 重复字词（的的、了了、是是）只标出来，不改 */
  repeats: boolean;
}

export const TIDY_DEFAULTS: TidyRules = { space: "off", punct: true, quotes: "off", dash: true, fullwidth: true, spaces: true, repeats: true };

export type TidyRule = "space" | "punct" | "quotes" | "dash" | "fullwidth" | "spaces";
export const TIDY_LABELS: Record<TidyRule, string> = {
  fullwidth: "全角字母、数字转半角",
  spaces: "连续空格、行末空格",
  punct: "半角标点转全角",
  dash: "省略号和破折号",
  quotes: "统一引号",
  space: "中英文之间的空格",
};

export interface TidyChange { from: number; to: number; insert: string }
export interface TidyRepeat { from: number; to: number; word: string }
export interface TidyResult {
  text: string;
  /** 相对原文的改动，按位置排好、互不重叠 */
  changes: TidyChange[];
  counts: Record<TidyRule, number>;
  total: number;
  repeats: TidyRepeat[];
}

/* ---------------- 字符分类 ---------------- */

const HAN_RE = /[㐀-䶿一-鿿豈-﫿぀-ヿ]/;
const CTX_RE = /[㐀-䶿一-鿿豈-﫿぀-ヿ　-〿＀-￯‘-”…—]/;
const isHan = (c: string) => !!c && HAN_RE.test(c);
/** 中文语境：汉字，或者全角标点、中文引号、省略号、破折号 */
const isCtx = (c: string) => !!c && CTX_RE.test(c);
const isLatin = (c: string) => !!c && /[A-Za-z0-9]/.test(c);
/** 强调符号不算「紧挨着」的那个字：**重点**. 里的 . 也算紧挨着中文 */
const MARKS = new Set(["*", "_", "~", "="]);
function prevCh(t: string, i: number) { let k = i - 1; while (k >= 0 && MARKS.has(t[k])) k--; return k >= 0 ? t[k] : ""; }
function nextCh(t: string, i: number) { let k = i + 1; while (k < t.length && MARKS.has(t[k])) k++; return k < t.length ? t[k] : ""; }

/* ---------------- 保护区：不能动的字 ---------------- */

const INLINE_PROTECT: RegExp[] = [
  /(`+)[^`]*?\1/g, // 行内代码
  /(?<![\\$])\$(?!\s)[^$\n]+?\$(?!\$)/g, // 行内公式
  /!\[[^\]]*\]\([^)]*\)(\{[^}]*\})?/g, // 图片（整个不动）
  /\]\([^)]*\)/g, // 链接地址
  /\]\[[^\]]*\]/g, // 引用式链接
  /\[@[^\]]*\]/g, // 文献引用
  /\[\^[^\]]*\]/g, // 脚注
  /<!--[\s\S]*?-->|<\/?[A-Za-z][^>]*>/g, // HTML 标签、自动链接
  /&#?\w+;/g, // HTML 实体
  /(?:https?|ftp|file):\/\/[^\s<>()　-〿＀-￯㐀-鿿]*[^\s<>()　-〿＀-￯㐀-鿿.,;:!?]/gi, // 网址（末尾的句点不算）
  /\bwww\.[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+[^\s<>()　-〿＀-￯㐀-鿿]*/gi,
  /[\w.+-]+@[\w-]+(?:\.[\w-]+)+/g, // 邮箱
  /(?:\b[A-Za-z]:[\\/]|(?<![\w.])(?:~|\.{1,2})\/|(?<![\w㐀-鿿\]).])\/(?=[\w.~-]))[\w.~\-/\\]*/g, // 路径：C:\、./、../、~/、/Users
  /\{>>@\S+\s+[^：\s]*：/g, // 批注开头的「@作者 日期：」
  /\{(?:==|>>|\+\+|--|~~)|(?:==|<<|\+\+|--|~~)\}|~>/g, // 批注（CriticMarkup）的标记符号
  /\{[#.][^}\n]*\}|\{[^}\n]*=[^}\n]*\}/g, // Pandoc 属性
  /\\./g, // 转义
];

export function protectedMask(text: string): Uint8Array {
  const m = new Uint8Array(text.length);
  const lines = text.split("\n");
  let pos = 0, i = 0;
  if (lines[0] === "---") {
    const e = lines.findIndex((l, k) => k > 0 && /^(---|\.\.\.)\s*$/.test(l));
    if (e > 0) { for (let k = 0; k <= e; k++) pos += lines[k].length + 1; m.fill(1, 0, Math.min(pos, text.length)); i = e + 1; }
  }
  let fence: RegExp | null = null, math = false;
  for (; i < lines.length; i++) {
    const l = lines[i], from = pos, to = pos + l.length;
    pos = to + 1;
    const t = l.trim();
    if (fence) { m.fill(1, from, to); if (fence.test(t)) fence = null; continue; }
    const f = t.match(/^(`{3,}|~{3,})/);
    if (f) { fence = new RegExp(`^${f[1][0] === "`" ? "`" : "~"}{${f[1].length},}\\s*$`); m.fill(1, from, to); continue; }
    if (math) { m.fill(1, from, to); if (t.endsWith("$$")) math = false; continue; }
    if (t.startsWith("$$")) { m.fill(1, from, to); if (t === "$$" || !(t.length > 4 && t.endsWith("$$"))) math = true; continue; }
    if (/^\s*<\/?[A-Za-z!]/.test(l)) { m.fill(1, from, to); continue; } // HTML 块
    if (/-/.test(l) && /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/.test(l)) { m.fill(1, from, to); continue; } // 表格分隔行
    if (/^\s*([-*_])(\s*\1){2,}\s*$/.test(l)) { m.fill(1, from, to); continue; } // 分隔线
    if (/^\s*\[[^\]^][^\]]*\]:\s/.test(l)) { m.fill(1, from, to); continue; } // 链接定义
    const fn = l.match(/^\s*\[\^[^\]]+\]:/);
    if (fn) m.fill(1, from, from + fn[0].length);
    // 行首的标记：引用、标题、列表、待办
    const lead = l.match(/^\s*(?:>\s*)*(?:#{1,6}\s+|(?:[-*+]|\d+[.)])\s+(?:\[[ xX]\]\s+)?)?/);
    if (lead && lead[0].length) m.fill(1, from, from + lead[0].length);
    for (const re of INLINE_PROTECT) {
      re.lastIndex = 0;
      for (let x: RegExpExecArray | null; (x = re.exec(l)); ) {
        if (!x[0].length) { re.lastIndex++; continue; }
        m.fill(1, from + x.index, from + x.index + x[0].length);
      }
    }
  }
  return m;
}

/* ---------------- 一遍一遍地处理 ---------------- */

interface Ctx { t: string; m: Uint8Array; lo: number; hi: number }
const free = (c: Ctx, a: number, b: number) => { if (a < c.lo || b > c.hi) return false; for (let k = a; k < b; k++) if (c.m[k]) return false; return true; };

function applyEdits(t: string, edits: TidyChange[]): string {
  edits.sort((a, b) => a.from - b.from);
  let out = "", last = 0;
  for (const e of edits) { if (e.from < last) continue; out += t.slice(last, e.from) + e.insert; last = e.to; }
  return out + t.slice(last);
}

/** 每一行的 [起点, 终点) */
function lineSpans(t: string): [number, number][] {
  const out: [number, number][] = [];
  let p = 0;
  for (const l of t.split("\n")) { out.push([p, p + l.length]); p += l.length + 1; }
  return out;
}

function passFullwidth(c: Ctx): TidyChange[] {
  const out: TidyChange[] = [];
  for (const x of c.t.matchAll(/[Ａ-Ｚａ-ｚ０-９]+/g)) {
    const a = x.index!, b = a + x[0].length;
    if (!free(c, a, b)) continue;
    out.push({ from: a, to: b, insert: [...x[0]].map((ch) => String.fromCharCode(ch.charCodeAt(0) - 0xfee0)).join("") });
  }
  return out;
}

function passSpaces(c: Ctx): TidyChange[] {
  const out: TidyChange[] = [];
  const spans = lineSpans(c.t);
  spans.forEach(([a, b], li) => {
    const l = c.t.slice(a, b);
    // 行中间的连续空格（行首的缩进不动）
    for (const x of l.matchAll(/(?<=\S) {2,}(?=\S)/g)) {
      const f = a + x.index!, e = f + x[0].length;
      if (free(c, f, e)) out.push({ from: f, to: e, insert: " " });
    }
    // 行末空格；两个以上空格接着下一行文字是 Markdown 的硬换行，保留
    const tail = l.match(/[ \t]+$/);
    if (!tail) return;
    const f = b - tail[0].length;
    const next = spans[li + 1] ? c.t.slice(spans[li + 1][0], spans[li + 1][1]) : "";
    if (/^ {2,}$/.test(tail[0]) && l.trim() && next.trim()) return;
    if (free(c, f, b)) out.push({ from: f, to: b, insert: "" });
  });
  return out;
}

const PUNCT: Record<string, string> = { ",": "，", ".": "。", ";": "；", ":": "：", "?": "？", "!": "！" };

function passPunct(c: Ctx): TidyChange[] {
  const t = c.t, out: TidyChange[] = [];
  /** 往后吞掉半角空格（全角标点自己带着间距），只在空格后面还有字时 */
  const swallowAfter = (i: number, need?: (ch: string) => boolean) => {
    let e = i + 1;
    while (t[e] === " " && !c.m[e]) e++;
    if (e === i + 1 || e >= t.length || t[e] === "\n" || (need && !need(t[e]))) return i + 1;
    return e;
  };
  for (let i = 0; i < t.length; i++) {
    const ch = t[i];
    if (!(ch in PUNCT) || !free(c, i, i + 1)) continue;
    // 紧跟在文献引用、脚注后面的标点，看引用前面的字：研究[@a]. → 研究[@a]。
    const cite = t[i - 1] === "]" ? t.slice(Math.max(0, i - 200), i).match(/\[[@^][^\]]*\]$/) : null;
    const p = prevCh(t, cite ? i - cite[0].length : i), n = nextCh(t, i);
    if (ch === "." && (t[i - 1] === "." || t[i + 1] === ".")) continue; // 省略号交给破折号那一条
    if ((ch === "." || ch === ":") && isLatin(n)) continue; // 报告.docx、10:30
    if (ch === ":" && n === "/") continue;
    if (!isCtx(p) && !isCtx(n)) continue;
    out.push({ from: i, to: swallowAfter(i), insert: PUNCT[ch] });
  }
  // 括号成对处理：一边转了另一边也转，不留下「（abc)」
  for (const [a, b] of lineSpans(t)) {
    const stack: number[] = [], pairs: [number, number][] = [], single: number[] = [];
    for (let i = a; i < b; i++) {
      if (c.m[i]) continue;
      if (t[i] === "(") stack.push(i);
      else if (t[i] === ")") { if (stack.length) pairs.push([stack.pop()!, i]); else single.push(i); }
    }
    single.push(...stack);
    const open = (i: number) => {
      // 前面的空格一起去掉：参见 (张三) → 参见（张三）
      let s = i;
      while (s > a && t[s - 1] === " " && !c.m[s - 1]) s--;
      if (s < i && !(s > a && isCtx(prevCh(t, s)))) s = i;
      return { from: s, to: i + 1, insert: "（" };
    };
    const close = (i: number) => ({ from: i, to: swallowAfter(i, isCtx), insert: "）" });
    for (const [x, y] of pairs) {
      if (!free(c, x, x + 1) || !free(c, y, y + 1)) continue;
      if (isCtx(prevCh(t, x)) || isCtx(nextCh(t, y)) || HAN_RE.test(t.slice(x + 1, y))) out.push(open(x), close(y));
    }
    for (const i of single) {
      if (!free(c, i, i + 1) || !(isCtx(prevCh(t, i)) || isCtx(nextCh(t, i)))) continue;
      out.push(t[i] === "(" ? open(i) : close(i));
    }
  }
  return out;
}

function passDash(c: Ctx): TidyChange[] {
  const t = c.t, out: TidyChange[] = [];
  const near = (a: number, b: number) => {
    let x = a - 1; while (x >= 0 && t[x] === " ") x--;
    let y = b; while (y < t.length && t[y] === " ") y++;
    return isCtx(x >= 0 ? t[x] : "") || isCtx(t[y] ?? "");
  };
  for (const x of t.matchAll(/\.{3,}|。{3,}/g)) {
    const a = x.index!, b = a + x[0].length;
    if (free(c, a, b) && (x[0][0] === "。" || near(a, b))) out.push({ from: a, to: b, insert: "……" });
  }
  for (const x of t.matchAll(/ *(?<!-)--(?!-) */g)) {
    const a = x.index!, b = a + x[0].length, core = a + x[0].indexOf("--");
    if (!free(c, core, core + 2) || !near(core, core + 2)) continue;
    if (core === 0 || t[core - 1] === "\n") continue;
    // 两边的空格一起去掉
    out.push({ from: free(c, a, core) ? a : core, to: free(c, core + 2, b) ? b : core + 2, insert: "——" });
  }
  return out;
}

function passQuotes(c: Ctx, target: "corner" | "curly"): TidyChange[] {
  const t = c.t, out: TidyChange[] = [];
  const [d1, d2, s1, s2] = target === "corner" ? ["「", "」", "『", "』"] : ["“", "”", "‘", "’"];
  for (const [a, b] of lineSpans(t)) {
    /** 在这一行里找成对的 open…close，满足 ok 就换成 to */
    const pairs = (open: string, close: string, ok: (x: number, y: number) => boolean, to: [string, string]) => {
      for (let i = a; i < b; i++) {
        if (t[i] !== open || c.m[i]) continue;
        let j = i + 1;
        while (j < b && (t[j] !== close || c.m[j])) j++;
        if (j >= b) break;
        if (free(c, i, i + 1) && free(c, j, j + 1) && ok(i, j)) out.push({ from: i, to: i + 1, insert: to[0] }, { from: j, to: j + 1, insert: to[1] });
        i = j;
      }
    };
    const chinese = (x: number, y: number) => HAN_RE.test(t.slice(x + 1, y)) || isHan(prevCh(t, x)) || isHan(nextCh(t, y));
    const inner = (x: number, y: number) => HAN_RE.test(t.slice(x + 1, y));
    if (target === "corner") {
      pairs("“", "”", chinese, [d1, d2]);
      pairs("‘", "’", inner, [s1, s2]); // Cohen’s 这种单独的撇号没有配对，不会动
    } else {
      pairs("「", "」", () => true, [d1, d2]);
      pairs("『", "』", () => true, [s1, s2]);
    }
    // 直引号："……" 在中文里换成目标引号
    const qs: number[] = [];
    for (let i = a; i < b; i++) if (t[i] === '"' && !c.m[i]) qs.push(i);
    for (let k = 0; k + 1 < qs.length; k += 2) {
      const [x, y] = [qs[k], qs[k + 1]];
      if (free(c, x, x + 1) && free(c, y, y + 1) && chinese(x, y)) out.push({ from: x, to: x + 1, insert: d1 }, { from: y, to: y + 1, insert: d2 });
    }
  }
  return out;
}

function passSpace(c: Ctx, mode: "add" | "remove"): TidyChange[] {
  const t = c.t, out: TidyChange[] = [];
  const left = (ch: string) => isLatin(ch) || ch === "%";
  if (mode === "add") {
    for (let i = 0; i + 1 < t.length; i++) {
      const x = t[i], y = t[i + 1];
      if (!((isHan(x) && isLatin(y)) || (left(x) && isHan(y)))) continue;
      if ((c.m[i] && c.m[i + 1]) || i + 1 < c.lo || i + 1 > c.hi) continue;
      out.push({ from: i + 1, to: i + 1, insert: " " });
    }
  } else {
    for (const x of t.matchAll(/ +/g)) {
      const a = x.index!, b = a + x[0].length;
      const l = t[a - 1] ?? "", r = t[b] ?? "";
      if (((isHan(l) && isLatin(r)) || (left(l) && isHan(r))) && free(c, a, b)) out.push({ from: a, to: b, insert: "" });
    }
  }
  return out;
}

const REPEAT_RE = /([的了是在和就也都把被])\1/g;
const IDIOMS = ["的的确确", "不了了之", "是是非非", "了了分明", "小时了了"];

function findRepeats(t: string, m: Uint8Array, lo: number, hi: number): TidyRepeat[] {
  const out: TidyRepeat[] = [];
  for (const x of t.matchAll(REPEAT_RE)) {
    const a = x.index!, b = a + 2;
    if (a < lo || b > hi || m[a] || m[a + 1]) continue;
    if (IDIOMS.some((w) => { for (let k = 0; k <= w.length - 2; k++) if (w.slice(k, k + 2) === x[0] && t.slice(a - k, a - k + w.length) === w) return true; return false; })) continue;
    out.push({ from: a, to: b, word: x[0] });
  }
  return out;
}

/** 逐行比较，得出相对原文的最小改动（整理不增删换行，行数不变） */
export function lineChanges(a: string, b: string): TidyChange[] {
  const A = a.split("\n"), B = b.split("\n");
  if (A.length !== B.length) return [{ from: 0, to: a.length, insert: b }];
  const out: TidyChange[] = [];
  let pos = 0;
  for (let i = 0; i < A.length; i++) {
    const x = A[i], y = B[i];
    if (x !== y) {
      let s = 0;
      while (s < x.length && s < y.length && x[s] === y[s]) s++;
      let e = 0;
      while (e < x.length - s && e < y.length - s && x[x.length - 1 - e] === y[y.length - 1 - e]) e++;
      out.push({ from: pos + s, to: pos + x.length - e, insert: y.slice(s, y.length - e) });
    }
    pos += x.length + 1;
  }
  return out;
}

/**
 * 整理。range 给出时只改这一段（选中的文字），保护区仍按全文判断（比如选区落在代码块里）。
 */
export function tidy(text: string, rules: TidyRules, range?: { from: number; to: number }): TidyResult {
  const counts: Record<TidyRule, number> = { fullwidth: 0, spaces: 0, punct: 0, dash: 0, quotes: 0, space: 0 };
  let t = text;
  const lo = range ? Math.max(0, range.from) : 0;
  let hi = range ? Math.min(text.length, range.to) : text.length;
  const run = (rule: TidyRule, f: (c: Ctx) => TidyChange[]) => {
    const edits = f({ t, m: protectedMask(t), lo, hi });
    if (!edits.length) return;
    counts[rule] += edits.length;
    hi += edits.reduce((d, e) => d + e.insert.length - (e.to - e.from), 0);
    t = applyEdits(t, edits);
  };
  if (rules.fullwidth) run("fullwidth", passFullwidth);
  if (rules.spaces) run("spaces", passSpaces);
  if (rules.punct) run("punct", passPunct);
  if (rules.dash) run("dash", passDash);
  if (rules.quotes !== "off") run("quotes", (c) => passQuotes(c, rules.quotes as "corner" | "curly"));
  if (rules.space !== "off") run("space", (c) => passSpace(c, rules.space as "add" | "remove"));
  // 括号、引号成对改动按一处算
  counts.quotes = Math.ceil(counts.quotes / 2);
  const changes = lineChanges(text, t);
  // 重复字词在原文上标，位置和编辑器对得上
  const repeats = rules.repeats ? findRepeats(text, protectedMask(text), range ? range.from : 0, range ? range.to : text.length) : [];
  return { text: t, changes, counts, total: Object.values(counts).reduce((a, b) => a + b, 0), repeats };
}
