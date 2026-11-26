/**
 * 导出：选项、Markdown 预处理、Word 样式换算、Typst 模板、Pandoc defaults 文件。
 * 全部是纯函数，方便测试；真正调用 Pandoc 的是 Rust 端（src-tauri/src/export.rs）。
 *
 * 选项没有预设：空字段表示“不改”，Word 用参考文档里的样式，PDF 用这里注明的默认值。
 */
import type { BibEntry } from "./bib";
import { shortAuthor } from "./bib";
import { join, normalize, toPosix } from "./paths";
import { fontFallbacks } from "./settings";

export type Fmt = "docx" | "pdf" | "md";
export type Level = "1" | "2" | "3";

export interface HeadingOpts {
  font: string;
  size: string;
  bold: "" | "1" | "0";
  align: "" | "left" | "center";
  before: string;
  after: string;
  /** 编号格式，例如 第{一}章、{1}.{2}；空表示保留原文 */
  num: string;
  color: "" | "black";
}

export interface ExportOptions {
  fmt: Fmt;
  /** 参考文档的完整路径（只用于 Word） */
  ref: string;
  paper: "" | "A4" | "A5" | "B5" | "16K" | "Letter" | "custom";
  pw: string; ph: string;
  mt: string; mb: string; ml: string; mr: string;
  header: string; headerAlign: "left" | "center" | "right";
  footer: string; footerAlign: "left" | "center" | "right";
  cjk: string; latin: string; size: string;
  lsMode: "multi" | "fixed"; ls: string;
  indent: string; before: string; after: string;
  align: "" | "left" | "justify" | "center";
  H: Record<Level, HeadingOpts>;
  /** CSL 样式文件的完整路径；空表示 Pandoc 默认（Chicago 作者-年份） */
  csl: string;
  notes: "comment" | "drop";
  toc: boolean;
  /** 行间公式编号（PDF） */
  eqNum: boolean;
  extra: string;
  mdNotes: "keep" | "drop";
  mdCite: "keep" | "text";
  mdFm: "keep" | "drop";
}

const H0: HeadingOpts = { font: "", size: "", bold: "", align: "", before: "", after: "", num: "", color: "" };
export const EMPTY: ExportOptions = {
  fmt: "docx", ref: "", paper: "", pw: "", ph: "", mt: "", mb: "", ml: "", mr: "",
  header: "", headerAlign: "center", footer: "", footerAlign: "center",
  cjk: "", latin: "", size: "", lsMode: "multi", ls: "", indent: "", before: "", after: "", align: "",
  H: { 1: { ...H0 }, 2: { ...H0 }, 3: { ...H0 } }, csl: "", notes: "comment", toc: false, eqNum: false, extra: "",
  mdNotes: "keep", mdCite: "keep", mdFm: "keep",
};
export function cloneOpts(o: ExportOptions): ExportOptions {
  return JSON.parse(JSON.stringify(o));
}
/** 旧版本存下来的选项可能缺字段 */
export function normalizeOpts(o: Partial<ExportOptions> | null | undefined): ExportOptions {
  const base = cloneOpts(EMPTY);
  if (!o) return base;
  const H = { ...base.H };
  (["1", "2", "3"] as Level[]).forEach((l) => { H[l] = { ...H0, ...(o.H?.[l] || {}) }; });
  return { ...base, ...o, H };
}

/** 纸张尺寸，毫米 */
export const PAPERS: Record<string, [number, number]> = { A4: [210, 297], A5: [148, 210], B5: [176, 250], "16K": [184, 260], Letter: [215.9, 279.4] };
/** 中文字号 */
export const CN_SIZES: [string, string][] = [
  ["42", "初号"], ["36", "小初"], ["26", "一号"], ["24", "小一"], ["22", "二号"], ["18", "小二"], ["16", "三号"], ["15", "小三"],
  ["14", "四号"], ["12", "小四"], ["10.5", "五号"], ["9", "小五"], ["7.5", "六号"],
];

/** PDF 没有参考文档，空字段用这些值；界面上作为占位提示显示 */
export const PDF_DEFAULTS = {
  paper: "A4", mt: "2.54", mb: "2.54", ml: "3.18", mr: "3.18",
  cjk: "Songti SC", latin: "Times New Roman", size: "12", ls: "1.5", indent: "2", before: "0", after: "0",
  H: { 1: { size: "16" }, 2: { size: "14" }, 3: { size: "12" } } as Record<Level, { size: string }>,
};
/** Pandoc 默认参考文档（Word）里的值，作为占位提示 */
export const DOCX_HINTS = {
  paper: "Letter", mt: "2.54", mb: "2.54", ml: "2.54", mr: "2.54", size: "12", ls: "1", indent: "0", before: "9", after: "9",
  H: { 1: { size: "20" }, 2: { size: "16" }, 3: { size: "14" } } as Record<Level, { size: string }>,
};

const n = (s: string) => { const v = parseFloat(s); return Number.isFinite(v) ? v : null; };

/* ---------------- 属性区、正文结构 ---------------- */

/** 拆出开头的 YAML 属性区 */
export function splitFrontMatter(md: string): { fm: string; body: string } {
  if (!md.startsWith("---\n")) return { fm: "", body: md };
  const m = md.slice(4).match(/\n(---|\.\.\.)[ \t]*(\n|$)/);
  if (!m || m.index === undefined) return { fm: "", body: md };
  const end = 4 + m.index + m[0].length;
  return { fm: md.slice(0, end), body: md.slice(end) };
}

/** 属性区里的简单字段（title、bibliography 这类单行或列表） */
export function fmField(fm: string, key: string): string[] {
  const lines = fm.split("\n");
  const i = lines.findIndex((l) => new RegExp(`^${key}:`).test(l));
  if (i < 0) return [];
  const v = lines[i].slice(key.length + 1).trim();
  const unq = (s: string) => s.trim().replace(/^["']|["']$/g, "");
  if (v.startsWith("[")) return v.slice(1, -1).split(",").map(unq).filter(Boolean);
  if (v) return [unq(v)];
  const out: string[] = [];
  for (let k = i + 1; k < lines.length && /^\s+-\s/.test(lines[k]); k++) out.push(unq(lines[k].replace(/^\s+-\s/, "")));
  return out;
}

/** 对正文里不在代码块中的每一行调用 f */
function mapLines(body: string, f: (line: string) => string): string {
  let fence: string | null = null;
  return body.split("\n").map((l) => {
    const t = l.trimStart();
    if (fence) { if (t.startsWith(fence)) fence = null; return l; }
    const m = t.match(/^(```+|~~~+)/);
    if (m) { fence = m[1]; return l; }
    return f(l);
  }).join("\n");
}

/* ---------------- 标题编号 ---------------- */

const CN = ["零", "一", "二", "三", "四", "五", "六", "七", "八", "九"];
export function cnNum(x: number): string {
  if (x < 10) return CN[x];
  if (x < 20) return "十" + (x % 10 ? CN[x % 10] : "");
  if (x < 100) return CN[Math.floor(x / 10)] + "十" + (x % 10 ? CN[x % 10] : "");
  return String(x);
}
const OLD_NUM = /^(第[一二三四五六七八九十百零〇\d]+[章节部分篇]|[\d一二三四五六七八九十]+(?:[.．][\d]+)*[.．、]?)(?=[\s　]|$)[\s　]*/;

/** 按格式重新编号：{1}{2}{3} 是阿拉伯数字，{一}{二}{三} 是对应级别的中文数字 */
export function numberHeadings(body: string, H: Record<Level, HeadingOpts>): string {
  if (!(["1", "2", "3"] as Level[]).some((l) => H[l].num.trim())) return body;
  const c = [0, 0, 0, 0];
  return mapLines(body, (l) => {
    const m = l.match(/^(#{1,6})\s+(.*)$/);
    if (!m) return l;
    const lv = m[1].length;
    if (lv <= 3) { c[lv]++; for (let k = lv + 1; k <= 3; k++) c[k] = 0; }
    const fmt = lv <= 3 ? H[String(lv) as Level].num.trim() : "";
    if (!fmt) return l;
    const pre = fmt.replace(/\{([123])\}/g, (_x, k) => String(c[+k])).replace(/\{([一二三])\}/g, (_x, k) => cnNum(c["一二三".indexOf(k) + 1]));
    return `${m[1]} ${pre}　${m[2].replace(OLD_NUM, "")}`;
  });
}

/* ---------------- 批注、引用、图片、图表 ---------------- */

const NOTE = /\{==([\s\S]+?)==\}\{>>([\s\S]*?)<<\}/g;
const LONE_NOTE = /\{>>[\s\S]*?<<\}/g;

function noteParts(body: string) {
  const m = body.match(/^@(\S+)\s+(\S+?)：([\s\S]*)$/);
  return m ? { who: m[1], date: m[2], text: m[3] } : { who: "", date: "", text: body };
}

/** 批注去掉标记，只留原文 */
export function dropNotes(s: string): string {
  return s.replace(NOTE, "$1").replace(LONE_NOTE, "");
}

/** 批注变成 Pandoc 的 Word 批注写法 */
export function notesToComments(s: string): string {
  let id = 0;
  return s.replace(NOTE, (_m, quote: string, body: string) => {
    const p = noteParts(body);
    const attrs = [`id="${id}"`, `author="${(p.who || "批注").replace(/"/g, "")}"`];
    if (/^\d{4}-\d{2}-\d{2}$/.test(p.date)) attrs.push(`date="${p.date}T00:00:00Z"`);
    const text = p.text.replace(/([[\]])/g, "\\$1");
    const out = `[${text}]{.comment-start ${attrs.join(" ")}}${quote}[]{.comment-end id="${id}"}`;
    id++;
    return out;
  }).replace(LONE_NOTE, "");
}

/** [@a] [@a; @b] → （作者，年份；作者，年份） */
export function citesToText(s: string, bib: Map<string, BibEntry>): string {
  return s.replace(/\[(@[\w:.-]+(?:\s*;\s*@[\w:.-]+)*)\]/g, (m, inner: string) => {
    const keys = inner.split(";").map((k) => k.trim().slice(1));
    if (!keys.every((k) => bib.has(k))) return m;
    return "（" + keys.map((k) => { const b = bib.get(k)!; return `${shortAuthor(b.author)}，${b.year}`; }).join("；") + "）";
  });
}

/** 文中引用到的文献，按首次出现的顺序 */
export function citedKeys(s: string): string[] {
  const out: string[] = [];
  for (const m of s.matchAll(/\[(@[\w:.-]+(?:\s*;\s*@[\w:.-]+)*)\]/g)) for (const k of m[1].split(";")) { const key = k.trim().slice(1); if (!out.includes(key)) out.push(key); }
  return out;
}

/** 绝对路径：macOS 的 /…，Windows 的 C:/… 或 C:\…（统一成正斜杠） */
function absolute(docDir: string, src: string) {
  if (/^(https?:|data:|hm-asset:|file:)/.test(src)) return src;
  let p = src;
  try { p = decodeURI(src); } catch { /* 保留原样 */ }
  if (/^[A-Za-z]:[\\/]|^\\\\/.test(p)) return normalize(toPosix(p));
  return p.startsWith("/") ? normalize(p) : normalize(join(docDir, p));
}

/**
 * 图片路径改成绝对路径；Mermaid 代码块换成待生成的图片。
 * localFiles 为真时（交给 Pandoc），本地图片再加上 hm-file: 前缀：Rust 端把它们复制进导出用的临时目录、
 * 改成相对文件名，Pandoc 和 Typst 都只读临时目录里的文件——Windows 的盘符路径、跨盘的图片都不成问题。
 */
export function prepareAssets(body: string, docDir: string, localFiles = false): { body: string; mermaid: string[] } {
  const mermaid: string[] = [];
  const lines = body.split("\n");
  const out: string[] = [];
  for (let i = 0; i < lines.length; i++) {
    const t = lines[i].trim();
    if (/^```+\s*mermaid\s*$/.test(t)) {
      const fence = t.match(/^`+/)![0];
      const code: string[] = [];
      let j = i + 1;
      while (j < lines.length && !lines[j].trim().startsWith(fence)) code.push(lines[j++]);
      mermaid.push(code.join("\n"));
      out.push(`![](hm-asset:mermaid-${mermaid.length}.png)`);
      i = j;
      continue;
    }
    out.push(lines[i]);
  }
  const joined = mapLines(out.join("\n"), (l) =>
    l.replace(/(!\[[^\]]*\]\()(<[^>]*>|[^)\s]+)((?:\s+"[^"]*")?\))/g, (_m, a: string, p: string, rest: string) => {
      const raw = p.startsWith("<") ? p.slice(1, -1) : p;
      const abs = absolute(docDir, raw);
      if (abs.startsWith("hm-asset:")) return a + abs + rest;
      const local = localFiles && !/^(https?:|data:|file:)/.test(abs);
      return a + `<${local ? "hm-file:" : ""}${abs}>` + rest;
    }),
  );
  return { body: joined, mermaid };
}

export interface Prepared {
  /** 交给 Pandoc 的 Markdown */
  markdown: string;
  mermaid: string[];
  /** 属性区里写的文献库（已换成绝对路径） */
  bibliography: string[];
  title: string;
}

/** Word / PDF：交给 Pandoc 之前的处理 */
export function prepareForPandoc(src: string, o: ExportOptions, docDir: string): Prepared {
  const { fm, body } = splitFrontMatter(src);
  let b = numberHeadings(body, o.H);
  b = o.fmt === "docx" && o.notes === "comment" ? notesToComments(b) : dropNotes(b);
  const assets = prepareAssets(b, docDir, true);
  const bibliography = fmField(fm, "bibliography").map((p) => absolute(docDir, p));
  const title = fmField(fm, "title")[0] || "";
  return { markdown: fm + assets.body, mermaid: assets.mermaid, bibliography, title };
}

/** Markdown 导出 */
export function markdownOut(src: string, o: ExportOptions, bib: Map<string, BibEntry>): string {
  let { fm, body } = splitFrontMatter(src);
  if (o.mdFm === "drop") fm = "";
  if (o.mdNotes === "drop") body = dropNotes(body);
  if (o.mdCite === "text") body = mapLines(body, (l) => citesToText(l, bib));
  return fm + body;
}

/* ---------------- Word：样式换算成 Word 单位 ---------------- */

export interface DocxStyle {
  page: [number, number] | null;
  margins: (number | null)[];
  header: { text: string; align: string } | null;
  footer: { text: string; align: string } | null;
  title: string;
  latin: string | null; cjk: string | null; size: number | null;
  line: [number, string] | null;
  indentChars: number | null; before: number | null; after: number | null;
  align: string | null;
  headings: { level: number; latin: string | null; cjk: string | null; size: number | null; bold: boolean | null; align: string | null; before: number | null; after: number | null; black: boolean }[];
}

const tw = (v: number | null, k: number) => (v === null ? null : Math.round(v * k));
const MM = 56.6929, CM = 566.929, PT = 20;
const JC: Record<string, string> = { left: "left", justify: "both", center: "center", right: "right" };

export function pageSize(o: ExportOptions): [number, number] | null {
  if (o.paper === "custom") { const w = n(o.pw), h = n(o.ph); return w && h ? [w, h] : null; }
  return o.paper ? PAPERS[o.paper] : null;
}

export function docxStyle(o: ExportOptions, title: string): DocxStyle {
  const ps = pageSize(o);
  const size = n(o.size);
  const ls = n(o.ls);
  return {
    page: ps ? [Math.round(ps[0] * MM), Math.round(ps[1] * MM)] : null,
    margins: [o.mt, o.mb, o.ml, o.mr].map((v) => tw(n(v), CM)),
    header: o.header.trim() ? { text: o.header, align: o.headerAlign } : null,
    footer: o.footer.trim() ? { text: o.footer, align: o.footerAlign } : null,
    title,
    latin: o.latin || null, cjk: o.cjk || null,
    size: size === null ? null : Math.round(size * 2),
    line: ls === null ? null : o.lsMode === "fixed" ? [Math.round(ls * PT), "exact"] : [Math.round(ls * 240), "auto"],
    indentChars: tw(n(o.indent), 100), before: tw(n(o.before), PT), after: tw(n(o.after), PT),
    align: o.align ? JC[o.align] : null,
    headings: (["1", "2", "3"] as Level[]).map((l) => {
      const h = o.H[l];
      const font = h.font || null;
      const hs = n(h.size);
      return {
        level: +l,
        latin: font ?? (o.latin || null), cjk: font ?? (o.cjk || null),
        size: hs === null ? null : Math.round(hs * 2),
        bold: h.bold === "" ? null : h.bold === "1",
        align: h.align ? JC[h.align] : null,
        before: tw(n(h.before), PT), after: tw(n(h.after), PT),
        black: h.color === "black",
      };
    }),
  };
}

/* ---------------- PDF：Typst 模板 ---------------- */

const tq = (s: string) => JSON.stringify(s);
/** 用户写的页眉页脚文字放进 Typst 内容块：转义标记符号，替换占位符 */
export function typstHF(text: string, title: string): string {
  const escd = (s: string) => s.replace(/([\\#\[\]*_`$<>@~=\/'"-])/g, "\\$1");
  return text.split(/(\{页码\}|\{总页数\}|\{标题\})/).map((p) =>
    p === "{页码}" ? "#counter(page).display()" : p === "{总页数}" ? "#counter(page).final().first()" : p === "{标题}" ? escd(title) : escd(p),
  ).join("");
}

export function fontList(...names: string[]): string {
  // 每个字体后面带上它在另一个系统上的对应字体：Mac 上写的「宋体-简」在 Windows 上用中易宋体排
  const seen = new Set<string>();
  const list = names.filter(Boolean).flatMap((n) => [n, ...fontFallbacks(n)]).filter((n) => !seen.has(n.toLowerCase()) && seen.add(n.toLowerCase()));
  return "(" + list.map(tq).join(", ") + (list.length === 1 ? "," : "") + ")";
}

/** Pandoc 的 Typst 模板。版式写成 Typst 的 set/show 规则，正文由 Pandoc 填进 $body$ */
export function typstTemplate(o: ExportOptions, title: string): string {
  const D = PDF_DEFAULTS;
  const v = (x: string, d: string) => (x.trim() ? x : d);
  const ps = pageSize(o) || PAPERS[D.paper];
  const size = +v(o.size, D.size);
  const latin = v(o.latin, D.latin), cjk = v(o.cjk, D.cjk);
  const ls = +v(o.ls, D.ls);
  // 行高按 Word 的算法近似：单倍行距约为字号的 1.3 倍；固定值直接用磅数
  const pitch = o.lsMode === "fixed" && o.ls.trim() ? ls : ls * 1.3 * size;
  const leading = Math.max(0, pitch - size);
  const before = +v(o.before, D.before), after = +v(o.after, D.after);
  const indent = +v(o.indent, D.indent);
  const align = o.align || "justify";
  const hf = (t: string, a: string) => `context [#set text(size: 9pt); #align(${a})[${typstHF(t, title)}]]`;
  const L: string[] = [];
  L.push(
    "// HolyMark 生成的 Pandoc Typst 模板。可以手动修改；在 HolyMark 里再次导出时会被覆盖。",
    "#let horizontalrule = line(start: (25%,0%), end: (75%,0%))",
    "#let blockquote(body) = block(inset: (left: 2em), body)",
    "#show terms.item: it => block(breakable: false)[",
    "  #text(weight: \"bold\")[#it.term]",
    "  #block(inset: (left: 1.5em, top: -0.4em))[#it.description]",
    "]",
    "#set table(inset: 6pt, stroke: 0.5pt)",
    ...(o.eqNum ? ["#set math.equation(numbering: \"(1)\")"] : []),
    "#show figure.where(kind: table): set figure.caption(position: top)",
    "#show figure.where(kind: image): set figure.caption(position: bottom)",
    "$if(highlighting-definitions)$",
    "$highlighting-definitions$",
    "$endif$",
    "",
    `#set page(width: ${ps[0]}mm, height: ${ps[1]}mm, margin: (top: ${v(o.mt, D.mt)}cm, bottom: ${v(o.mb, D.mb)}cm, left: ${v(o.ml, D.ml)}cm, right: ${v(o.mr, D.mr)}cm)` +
      (o.header.trim() ? `, header: ${hf(o.header, o.headerAlign)}` : "") +
      (o.footer.trim() ? `, footer: ${hf(o.footer, o.footerAlign)}` : "") + ")",
    `#set text(font: ${fontList(latin, cjk)}, size: ${size}pt, lang: "zh", region: "cn", top-edge: 0.8em, bottom-edge: -0.2em)`,
    `#set par(justify: ${align === "justify"}, leading: ${leading.toFixed(2)}pt, spacing: ${(leading + before + after).toFixed(2)}pt, first-line-indent: (amount: ${indent}em, all: true))`,
    ...(align === "center" ? ["#set align(center)"] : []),
    `#show raw: set text(font: ${fontList("Menlo", "SF Mono", "Consolas", "Courier New", cjk)})`,
    "#show heading: set par(first-line-indent: 0em)",
    // 参考文献、引用块、图表不缩进
    "#show <refs>: set par(first-line-indent: 0em)",
    "#show quote: set par(first-line-indent: 0em)",
    "#show figure: set par(first-line-indent: 0em)",
  );
  (["1", "2", "3"] as Level[]).forEach((l) => {
    const h = o.H[l];
    const w = `heading.where(level: ${l})`;
    const font = h.font ? fontList(h.font) : null;
    const rules: string[] = [];
    const sz = h.size.trim() || D.H[l].size;
    rules.push(`#show ${w}: set text(size: ${sz}pt${font ? `, font: ${font}` : ""}${h.bold ? `, weight: ${h.bold === "1" ? '"bold"' : '"regular"'}` : ""})`);
    if (h.align) rules.push(`#show ${w}: set align(${h.align})`);
    if (h.before.trim() || h.after.trim()) rules.push(`#show ${w}: set block(above: ${v(h.before, "12")}pt, below: ${v(h.after, "6")}pt)`);
    L.push(...rules);
  });
  L.push(
    "",
    "$if(title)$",
    "#align(center, block(below: 1.5em)[#text(size: 1.6em, weight: \"bold\")[$title$]])",
    "$endif$",
    "$if(toc)$",
    "#outline(title: [目录], depth: $toc-depth$)",
    "$endif$",
    "",
    "$body$",
    "",
  );
  return L.join("\n");
}

/* ---------------- Pandoc defaults 文件 ---------------- */

export interface DefaultsCtx {
  /** 文件夹里所有 .bib，再加上属性区里写的 */
  bibliography: string[];
  docDir: string;
}

/** 额外参数：按空格分开，引号里的空格保留 */
export function splitArgs(s: string): string[] {
  return (s.match(/"[^"]*"|'[^']*'|\S+/g) || []).map((a) => a.replace(/^["']|["']$/g, ""));
}

export function defaultsName(fmt: Fmt) {
  return fmt === "pdf" ? "pdf.yaml" : "word.yaml";
}

export function defaultsYaml(o: ExportOptions, ctx: DefaultsCtx): string {
  const L: string[] = [];
  const isPdf = o.fmt === "pdf";
  L.push(
    "# HolyMark 导出配置（Pandoc defaults 文件），每次导出时更新。",
    `# 命令行里也能用：pandoc -d .holymark/export/${defaultsName(o.fmt)} 稿件.md -o 稿件.${isPdf ? "pdf" : "docx"}`,
    "from: markdown+east_asian_line_breaks+mark+lists_without_preceding_blankline",
    `to: ${isPdf ? "typst" : "docx"}`,
    "standalone: true",
  );
  if (isPdf) {
    L.push("template: ${.}/pdf-template.typst", "pdf-engine: typst", "pdf-engine-opts: [\"--root\", \"/\"]");
  } else {
    L.push("reference-doc: ${.}/word-reference.docx");
  }
  L.push(`resource-path: [${tq(ctx.docDir)}]`);
  const bibs = [...new Set(ctx.bibliography)];
  if (bibs.length) {
    L.push("citeproc: true", "bibliography:", ...bibs.map((b) => `  - ${tq(b)}`));
    if (o.csl) L.push(`csl: ${tq(o.csl)}`);
  }
  if (o.toc) L.push("table-of-contents: true", "toc-depth: 3");
  L.push("metadata:", "  lang: zh-CN", "  reference-section-title: 参考文献");
  if (o.toc) L.push("  toc-title: 目录");
  return L.join("\n") + "\n";
}

/* ---------------- 记住选项和预设 ---------------- */

const KEY = "holymark-export";
/** Word 和 PDF 共用一套选项，切换格式不用重填 */
interface Saved { last: ExportOptions | null; presets: { name: string; opts: ExportOptions }[] }
export function loadSaved(): Saved {
  try {
    const s = JSON.parse(localStorage.getItem(KEY) || "{}");
    const last = s.last && typeof s.last === "object" && "fmt" in s.last ? normalizeOpts(s.last) : null;
    return { last, presets: Array.isArray(s.presets) ? s.presets : [] };
  } catch { return { last: null, presets: [] }; }
}
export function save(s: Saved) {
  try { localStorage.setItem(KEY, JSON.stringify(s)); } catch { /* 存不下就算了 */ }
}
