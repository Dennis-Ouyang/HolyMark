/**
 * 实时预览：光标所在的块显示 Markdown 源码，其余块隐藏语法符号、渲染公式/表格/图表/图片。
 * 思路与 Obsidian 的 Live Preview 相同：文档始终是纯文本，渲染只是装饰（decoration），不会改写文件。
 */
import { ChangeSet, EditorState, Extension, Range, StateEffect, StateField } from "@codemirror/state";
import { Decoration, DecorationSet, EditorView, WidgetType } from "@codemirror/view";
import { syntaxTree } from "@codemirror/language";
import type { SyntaxNode } from "@lezer/common";
import katex from "katex";
import { TableWidget } from "./tableWidget";

export interface PreviewOptions {
  /** 把文档里的图片路径解析成可显示的地址 */
  resolveImage: (src: string) => string;
  /** 把 [@key] 显示成什么，例如 “张伟, 2021” */
  citeLabel: (key: string) => string;
  /** 语法显示方式：只在光标所在块显示，或始终显示 */
  syntax: () => "active" | "always";
}

interface Block {
  from: number;
  to: number;
  kind: string;
  node?: SyntaxNode;
}

/* ---------------- widgets ---------------- */

function focusAt(view: EditorView, dom: HTMLElement, e: Event, offset = 0) {
  e.preventDefault();
  const pos = view.posAtDOM(dom) + offset;
  view.dispatch({ selection: { anchor: Math.min(pos, view.state.doc.length) } });
  view.focus();
}

class MathWidget extends WidgetType {
  constructor(readonly tex: string, readonly display: boolean) { super(); }
  eq(o: MathWidget) { return o.tex === this.tex && o.display === this.display; }
  toDOM(view: EditorView) {
    const el = document.createElement(this.display ? "div" : "span");
    el.className = this.display ? "hm-math-block" : "hm-math-inline";
    try {
      katex.render(this.tex, el, { displayMode: this.display, throwOnError: false, output: "html" });
    } catch {
      el.textContent = this.tex;
    }
    el.addEventListener("mousedown", (e) => focusAt(view, el, e, this.display ? 3 : 1));
    return el;
  }
  ignoreEvent() { return false; }
}

let mermaidSeq = 0;
class MermaidWidget extends WidgetType {
  constructor(readonly code: string) { super(); }
  eq(o: MermaidWidget) { return o.code === this.code; }
  toDOM(view: EditorView) {
    const el = document.createElement("div");
    el.className = "hm-mermaid";
    el.textContent = "正在绘制图表…";
    import("mermaid").then(async ({ default: mermaid }) => {
      const dark = document.documentElement.dataset.theme === "dark" ||
        (!document.documentElement.dataset.theme && matchMedia("(prefers-color-scheme: dark)").matches);
      mermaid.initialize({ startOnLoad: false, theme: dark ? "dark" : "neutral", securityLevel: "strict" });
      try {
        const { svg } = await mermaid.render("hm-mm-" + ++mermaidSeq, this.code);
        el.innerHTML = svg;
      } catch {
        el.textContent = "Mermaid 语法有误，点这里修改";
      }
    });
    el.addEventListener("mousedown", (e) => focusAt(view, el, e, 11));
    return el;
  }
  ignoreEvent() { return false; }
}

class FrontMatterWidget extends WidgetType {
  constructor(readonly yaml: string) { super(); }
  eq(o: FrontMatterWidget) { return o.yaml === this.yaml; }
  toDOM(view: EditorView) {
    const el = document.createElement("div");
    el.className = "hm-props";
    el.title = "文件属性（YAML）";
    let inner = "";
    for (const line of this.yaml.split("\n")) {
      const m = line.match(/^([\w-]+):\s*(.+)$/);
      const sub = line.match(/^\s+([\w-]+):\s*(.+)$/);
      if (m) inner += `<span class="hm-prop"><b>${esc(m[1])}</b>${esc(m[2])}</span>`;
      else if (sub) inner += `<span class="hm-prop sub"><b>${esc(sub[1])}</b>${esc(sub[2])}</span>`;
    }
    el.innerHTML = inner || `<span class="hm-prop">属性</span>`;
    el.addEventListener("mousedown", (e) => focusAt(view, el, e, 4));
    return el;
  }
  ignoreEvent() { return false; }
}

class ImageWidget extends WidgetType {
  constructor(readonly src: string, readonly alt: string, readonly block: boolean, readonly opts: PreviewOptions) { super(); }
  eq(o: ImageWidget) { return o.src === this.src && o.alt === this.alt && o.block === this.block; }
  toDOM(view: EditorView) {
    const el = document.createElement(this.block ? "figure" : "span");
    el.className = this.block ? "hm-figure" : "hm-img-inline";
    const img = document.createElement("img");
    img.src = this.opts.resolveImage(this.src);
    img.alt = this.alt;
    img.onerror = () => { el.classList.add("missing"); el.setAttribute("data-missing", `找不到图片 ${this.src}`); };
    el.appendChild(img);
    if (this.block && this.alt) {
      const cap = document.createElement("figcaption");
      cap.textContent = this.alt;
      el.appendChild(cap);
    }
    el.addEventListener("mousedown", (e) => focusAt(view, el, e, 2));
    return el;
  }
  ignoreEvent() { return false; }
}

class CiteWidget extends WidgetType {
  constructor(readonly key: string, readonly label: string) { super(); }
  eq(o: CiteWidget) { return o.key === this.key && o.label === this.label; }
  toDOM(view: EditorView) {
    const el = document.createElement("span");
    el.className = "hm-cite";
    el.textContent = this.label;
    el.title = "@" + this.key;
    el.addEventListener("mousedown", (e) => focusAt(view, el, e, 1));
    return el;
  }
  ignoreEvent() { return false; }
}

class CheckboxWidget extends WidgetType {
  constructor(readonly checked: boolean) { super(); }
  eq(o: CheckboxWidget) { return o.checked === this.checked; }
  toDOM(view: EditorView) {
    const el = document.createElement("span");
    el.className = "hm-check" + (this.checked ? " on" : "");
    el.setAttribute("role", "checkbox");
    el.setAttribute("aria-checked", String(this.checked));
    el.innerHTML = this.checked ? '<svg width="11" height="11" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="m3.5 8.5 3 3 6-7"/></svg>' : "";
    el.addEventListener("mousedown", (e) => {
      e.preventDefault();
      const pos = view.posAtDOM(el);
      view.dispatch({ changes: { from: pos + 1, to: pos + 2, insert: this.checked ? " " : "x" } });
    });
    return el;
  }
  ignoreEvent() { return false; }
}

class TextWidget extends WidgetType {
  constructor(readonly text: string, readonly cls: string) { super(); }
  eq(o: TextWidget) { return o.text === this.text && o.cls === this.cls; }
  toDOM() {
    const el = document.createElement("span");
    el.className = this.cls;
    el.textContent = this.text;
    return el;
  }
}

/* ---------------- helpers ---------------- */

export function esc(s: string) {
  return s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]!));
}

/** 表格单元格等场合用的简易行内渲染 */
export function renderInlineHTML(s: string, opts: PreviewOptions) {
  let h = esc(s);
  h = h.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
  h = h.replace(/(^|[^*])\*([^*\s][^*]*)\*/g, "$1<em>$2</em>");
  h = h.replace(/`([^`]+)`/g, '<code class="hm-icode">$1</code>');
  h = h.replace(/~~([^~]+)~~/g, "<s>$1</s>");
  h = h.replace(/\[@([\w:-]+)\]/g, (_m, k) => `<span class="hm-cite">${esc(opts.citeLabel(k))}</span>`);
  h = h.replace(/\$([^$\n]+)\$/g, (_m, t) => {
    try { return katex.renderToString(t.replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">"), { throwOnError: false }); } catch { return t; }
  });
  return h;
}

const FENCE_LIKE = new Set(["FencedCode", "CodeBlock"]);

/** YAML 属性区和 $$ 公式块不在 lezer 的 Markdown 语法里，单独识别 */
function customBlocks(state: EditorState): Block[] {
  const doc = state.doc;
  const out: Block[] = [];
  const tree = syntaxTree(state);
  const inCode = (pos: number) => {
    for (let n: SyntaxNode | null = tree.resolveInner(pos, 1); n; n = n.parent) if (FENCE_LIKE.has(n.name)) return true;
    return false;
  };
  // 逐行走一遍（iterLines 不必每行查一次行号，长稿里快得多）
  let pos = 0, lineNo = 0;
  let front: "maybe" | "in" | "done" = "maybe";
  let mathFrom = -1, mathLine = 0;
  for (const it = doc.iterLines(); !it.next().done; ) {
    const text = it.value, from = pos;
    pos += text.length + 1;
    lineNo++;
    if (front === "maybe") { front = text === "---" && doc.lines >= 2 ? "in" : "done"; if (front === "in") continue; }
    if (front === "in") {
      if (/^(---|\.\.\.)\s*$/.test(text)) { out.push({ from: 0, to: from + text.length, kind: "frontmatter" }); front = "done"; }
      else if (lineNo === doc.lines) return customBlocksFrom(state, 1, out); // 属性区没有闭合：当普通正文处理
      continue;
    }
    const t = text.trim();
    if (mathFrom >= 0) {
      if (t === "$$") { out.push({ from: mathFrom, to: from + text.length, kind: "math" }); mathFrom = -1; }
      continue;
    }
    if (!t.startsWith("$$") || inCode(from)) continue;
    if (t.length > 4 && t.endsWith("$$")) out.push({ from, to: from + text.length, kind: "math" });
    else if (t === "$$") { mathFrom = from; mathLine = lineNo; }
  }
  // 没有闭合的 $$ 不算公式块，从它后面一行接着找
  if (mathFrom >= 0) return customBlocksFrom(state, mathLine + 1, out);
  return out;
}

/** 逐行查行号的慢路径：只在属性区或公式块没有闭合时，从第 start 行起接着找 */
function customBlocksFrom(state: EditorState, start: number, out: Block[]): Block[] {
  const doc = state.doc;
  const tree = syntaxTree(state);
  for (let i = start; i <= doc.lines; i++) {
    const line = doc.line(i);
    const t = line.text.trim();
    if (!t.startsWith("$$")) continue;
    let code = false;
    for (let n: SyntaxNode | null = tree.resolveInner(line.from, 1); n; n = n.parent) if (FENCE_LIKE.has(n.name)) { code = true; break; }
    if (code) continue;
    if (t.length > 4 && t.endsWith("$$")) { out.push({ from: line.from, to: line.to, kind: "math" }); continue; }
    if (t !== "$$") continue;
    for (let j = i + 1; j <= doc.lines; j++) {
      if (doc.line(j).text.trim() === "$$") { out.push({ from: line.from, to: doc.line(j).to, kind: "math" }); i = j; break; }
    }
  }
  return out;
}

export function topBlocks(state: EditorState): Block[] {
  const custom = customBlocks(state);
  const out: Block[] = [];
  // 两个列表都按位置排好，归并即可；与属性区、公式块重叠的语法节点不要
  let k = 0;
  for (let child = syntaxTree(state).topNode.firstChild; child; child = child.nextSibling) {
    while (k < custom.length && custom[k].to < child.from) out.push(custom[k++]);
    let overlap = false;
    for (let c = k; c < custom.length && custom[c].from <= child.to; c++) if (child.from <= custom[c].to) { overlap = true; break; }
    if (!overlap) out.push({ from: child.from, to: child.to, kind: child.name, node: child });
  }
  while (k < custom.length) out.push(custom[k++]);
  return out;
}

/* ---------------- decoration builder ---------------- */

const hide = Decoration.replace({});
const lineCls = (cls: string) => Decoration.line({ class: cls });
const markCls = (cls: string) => Decoration.mark({ class: cls });

/** 编辑器有焦点时才把光标所在块显示为源码；刚打开文件、焦点在别处时整篇都按格式显示 */
export const setFocus = StateEffect.define<boolean>();
const focusField = StateField.define<boolean>({
  create: () => false,
  update: (v, tr) => { for (const e of tr.effects) if (e.is(setFocus)) return e.value; return v; },
});

/**
 * 装饰的增量更新。整篇文档按块切成若干「区段」：每个区段从上一块结束后的那一行开始，
 * 到本块最后一行结束（块前面的空行算在它的区段里）。每次更新：
 *   1. 旧的装饰集合整体随改动平移（RangeSet.map，代价与改动大小有关，与全文长度无关）；
 *   2. 只有被改动碰到、或者光标进出的区段重新计算装饰，替换掉原来的；
 *   3. 一块的装饰按「块类型 + 是否显示源码 + 原文」缓存，同样的块（比如挪了位置）不重算。
 * 这样长稿里每次按键的开销基本与全文长度无关。改动太多（比如整篇替换）时退回整篇重建。
 */
type Local = { from: number; to: number; deco: Decoration }[];
interface Zone { zone: number; base: number; end: number; sig: string; block: Block; active: boolean; gap: number }
interface Memo {
  cache: Map<string, Local>;
  /** 文档和语法树都没变时（只挪了光标），块列表直接沿用 */
  doc: EditorState["doc"] | null;
  tree: unknown;
  blocks: Block[];
  /** 上一次的区段（旧文档里的位置），用来判断哪些区段没变 */
  zones: Zone[];
}
export function newMemo(): Memo { return { cache: new Map(), doc: null, tree: null, blocks: [], zones: [] }; }

const MAX_DIRTY = 40;

export function build(state: EditorState, opts: PreviewOptions, memo: Memo = newMemo(), prev?: { value: DecorationSet; changes: ChangeSet }): DecorationSet {
  const always = opts.syntax() === "always";
  const focused = state.field(focusField, false) ?? false;
  const doc = state.doc;
  const sel = state.selection.ranges;
  const tree = syntaxTree(state);
  let blocks: Block[];
  if (memo.doc === doc && memo.tree === tree) blocks = memo.blocks;
  else { blocks = topBlocks(state); memo.doc = doc; memo.tree = tree; memo.blocks = blocks; }
  const isActive = (b: Block) => always || (focused && sel.some((r) => r.from <= b.to && r.to >= b.from));

  /** 第 j 块的区段信息（要查行号，只对变了的块调用） */
  const zoneOf = (j: number, active: boolean): Zone => {
    const b = blocks[j];
    const startLine = doc.lineAt(b.from), endLine = doc.lineAt(b.to);
    const prevEnd = j ? doc.lineAt(blocks[j - 1].to).number : 0; // 上一块最后一行的行号
    const zone = prevEnd ? doc.line(prevEnd + 1).from : 0;
    // 段落之间只隔一个空行时，这个空行收窄成段距；连续多个空行按正常行高显示，光标进出也不变
    let gap = -1;
    if (prevEnd && startLine.number - prevEnd === 2) {
      const g = doc.line(prevEnd + 1);
      if (!g.text.trim() && doc.line(prevEnd).text.trim() && startLine.text.trim()) gap = g.from;
    }
    const base = startLine.from;
    const sig = `${b.kind}|${active ? 1 : 0}|${gap < 0 ? 0 : 1}|${base - zone}|${b.from - base}|${b.to - base}|${endLine.to - base}`;
    return { zone, base, end: endLine.to, sig, block: b, active, gap };
  };

  const decosOf = (z: Zone, next: Map<string, Local>): Range<Decoration>[] => {
    const out: Range<Decoration>[] = [];
    if (z.gap >= 0) out.push(lineCls("hm-gap").range(z.gap));
    const key = `${z.sig}|${doc.sliceString(z.base, z.end)}`;
    let local = next.get(key) ?? memo.cache.get(key);
    if (!local) {
      const abs: Range<Decoration>[] = [];
      blockDecos(state, z.block, z.active, abs, opts);
      local = abs.map((r) => ({ from: r.from - z.base, to: r.to - z.base, deco: r.value }));
    }
    next.set(key, local);
    for (const l of local) out.push(l.deco.range(l.from + z.base, l.to + z.base));
    return out;
  };

  // 增量路径：新旧块按位置一一对上、没被改动碰到、前一块也对上、显示方式没变的，就是没变的块
  if (prev && memo.zones.length) {
    const old = memo.zones, ch = prev.changes;
    const map = (p: number) => (ch.empty ? p : ch.mapPos(p));
    const zones: Zone[] = new Array(blocks.length);
    const dirty: Zone[] = [];
    let i = 0, prevMatched = -2;
    for (let j = 0; j < blocks.length; j++) {
      const b = blocks[j];
      while (i < old.length && map(old[i].block.from) < b.from) i++;
      let matched = -1;
      if (i < old.length) {
        const o = old[i];
        if (o.block.kind === b.kind && map(o.block.from) === b.from && map(o.block.to) === b.to && (ch.empty || !ch.touchesRange(o.zone, o.end))) matched = i;
      }
      const active = isActive(b);
      if (matched >= 0 && (j === 0 ? matched === 0 : prevMatched === matched - 1) && old[matched].active === active) {
        const o = old[matched];
        zones[j] = ch.empty ? { ...o, block: b } : { ...o, block: b, zone: map(o.zone), base: map(o.base), end: map(o.end), gap: o.gap < 0 ? -1 : map(o.gap) };
      } else {
        zones[j] = zoneOf(j, active);
        dirty.push(zones[j]);
      }
      prevMatched = matched;
    }
    if (dirty.length <= MAX_DIRTY) {
      if (memo.cache.size > 4 * zones.length + 200) memo.cache.clear();
      let value = ch.empty ? prev.value : prev.value.map(ch);
      for (const z of dirty) {
        value = value.update({ filterFrom: z.zone, filterTo: z.end, filter: (f) => f < z.zone || f > z.end, add: decosOf(z, memo.cache), sort: true });
      }
      // 最后一块之后只有空行，不该有装饰（删掉末尾的块时，旧装饰会被挤到这里）
      const tail = zones.length ? zones[zones.length - 1].end + 1 : 0;
      if (tail <= doc.length) value = value.update({ filterFrom: tail, filterTo: doc.length, filter: (f) => f < tail });
      memo.zones = zones;
      return value;
    }
  }

  // 整篇重建
  const zones = blocks.map((b, j) => zoneOf(j, isActive(b)));
  const next = new Map<string, Local>();
  const out: Range<Decoration>[] = [];
  for (const z of zones) for (const r of decosOf(z, next)) out.push(r);
  memo.cache = next;
  memo.zones = zones;
  // 各区段的装饰本来就按顺序排好，这里的排序几乎是线性的
  return Decoration.set(out, true);
}

/** 一个块的全部装饰（绝对位置） */
function blockDecos(state: EditorState, b: Block, active: boolean, decos: Range<Decoration>[], opts: PreviewOptions) {
  const doc = state.doc;
  const linesOf = (b: Block, cls: string | ((n: number, i: number, last: boolean) => string)) => {
    const a = doc.lineAt(b.from).number, z = doc.lineAt(b.to).number;
    for (let n = a; n <= z; n++) {
      const c = typeof cls === "string" ? cls : cls(n, n - a, n === z);
      if (c) decos.push(lineCls(c).range(doc.line(n).from));
    }
  };
  const blockReplace = (b: Block, widget: WidgetType) => {
    const from = doc.lineAt(b.from).from, to = doc.lineAt(b.to).to;
    decos.push(Decoration.replace({ widget, block: true }).range(from, to));
  };

  const text = doc.sliceString(b.from, b.to);

  if (b.kind === "frontmatter") {
    if (active) linesOf(b, "hm-src-mono");
    else blockReplace(b, new FrontMatterWidget(text.replace(/^---\n?|\n?---\s*$/g, "")));
    return;
  }
  if (b.kind === "math") {
    const tex = text.trim().replace(/^\$\$/, "").replace(/\$\$$/, "").trim();
    if (active) linesOf(b, "hm-src-mono");
    else blockReplace(b, new MathWidget(tex, true));
    return;
  }
  if (b.kind === "FencedCode") {
    const ci = b.node!.getChild("CodeInfo");
    const info = (ci && doc.sliceString(ci.from, ci.to)) || "";
    if (!active && info.trim() === "mermaid") {
      blockReplace(b, new MermaidWidget(text.replace(/^```mermaid\s*\n?/, "").replace(/\n?```\s*$/, "")));
      return;
    }
    linesOf(b, (_n, i, last) => "hm-code" + (i === 0 ? " hm-code-first" : "") + (last ? " hm-code-last" : ""));
    if (!active) {
      const first = doc.lineAt(b.from), last = doc.lineAt(b.to);
      decos.push(Decoration.replace({ widget: new TextWidget(info.trim() || "代码", "hm-code-lang") }).range(first.from, first.to));
      if (last.number !== first.number && /^\s*```/.test(last.text)) decos.push(hide.range(last.from, last.to));
    }
    return;
  }
  if (b.kind === "Table") {
    if (active) linesOf(b, "hm-src-mono");
    else blockReplace(b, new TableWidget(text, (c) => renderInlineHTML(c, opts)));
    return;
  }
  if (b.kind === "HorizontalRule") {
    if (!active) decos.push(Decoration.replace({ widget: new TextWidget("", "hm-hr") }).range(b.from, b.to));
    return;
  }
  // 只有一张图片的段落：显示为带图注的插图
  if (b.kind === "Paragraph" && /^!\[[^\]]*\]\([^)]*\)\s*$/.test(text)) {
    if (!active) {
      const m = text.match(/^!\[([^\]]*)\]\(([^)]*)\)/)!;
      blockReplace(b, new ImageWidget(m[2], m[1], true, opts));
    }
    return;
  }
  if (/^ATXHeading(\d)/.test(b.kind)) {
    const lv = Math.min(3, +b.kind.slice(-1));
    decos.push(lineCls(`hm-h hm-h${lv}`).range(doc.lineAt(b.from).from));
  }
  if (b.kind === "Blockquote") linesOf(b, "hm-quote");
  if (b.kind === "BulletList" || b.kind === "OrderedList") linesOf(b, "hm-list");
  inlineDecos(state, b, active, decos, opts);
}

/** 行内：强调、代码、链接、图片、任务框、引用、公式、批注 */
function inlineDecos(state: EditorState, b: Block, active: boolean, decos: Range<Decoration>[], opts: PreviewOptions) {
  const doc = state.doc;
  const codeRanges: [number, number][] = [];
  const taken: [number, number][] = [];
  const free = (f: number, t: number) => !taken.some(([a, z]) => f < z && t > a);

  syntaxTree(state).iterate({
    from: b.from,
    to: b.to,
    enter: (n) => {
      const name = n.name;
      if (name === "InlineCode") { codeRanges.push([n.from, n.to]); decos.push(markCls("hm-icode").range(n.from, n.to)); }
      if (name === "StrongEmphasis") decos.push(markCls("hm-strong").range(n.from, n.to));
      if (name === "Emphasis") decos.push(markCls("hm-em").range(n.from, n.to));
      if (name === "Strikethrough") decos.push(markCls("hm-strike").range(n.from, n.to));
      // [@key] 是文献引用，不按链接处理
      if (name === "Link" && /^\[@[\w:-]+\]$/.test(doc.sliceString(n.from, n.to))) return false;
      if (name === "Link") decos.push(markCls("hm-link").range(n.from, n.to));
      const marker = ["EmphasisMark", "CodeMark", "StrikethroughMark", "LinkMark", "URL", "LinkTitle"].includes(name);
      if (marker) {
        const parent = n.node.parent?.name;
        if (name === "CodeMark" && parent !== "InlineCode") return;
        if ((name === "URL" || name === "LinkTitle") && parent !== "Link") return;
        if (name === "LinkMark" && parent === "Image") return;
        if (active) decos.push(markCls("hm-mark").range(n.from, n.to));
        else if (n.to > n.from) { decos.push(hide.range(n.from, n.to)); taken.push([n.from, n.to]); }
      }
      if (name === "HeaderMark" || name === "QuoteMark") {
        const after = doc.sliceString(n.to, n.to + 1) === " " ? n.to + 1 : n.to;
        if (active) decos.push(markCls("hm-mark").range(n.from, after));
        else { decos.push(hide.range(n.from, after)); taken.push([n.from, after]); }
      }
      if (name === "ListMark" && !active) {
        const t = doc.sliceString(n.from, n.to);
        const task = /^\s?\[[ xX]\]/.test(doc.sliceString(n.to, n.to + 5));
        if (/^[-*+]$/.test(t)) {
          const end = doc.sliceString(n.to, n.to + 1) === " " ? n.to + 1 : n.to;
          decos.push(Decoration.replace({ widget: new TextWidget(task ? "" : "•", task ? "hm-bullet-none" : "hm-bullet") }).range(n.from, end));
          taken.push([n.from, end]);
        }
      } else if (name === "ListMark" && active) decos.push(markCls("hm-mark").range(n.from, n.to));
      if (name === "TaskMarker" && !active) {
        const checked = /x/i.test(doc.sliceString(n.from, n.to));
        decos.push(Decoration.replace({ widget: new CheckboxWidget(checked) }).range(n.from, n.to));
        taken.push([n.from, n.to]);
      }
      if (name === "Image" && !active) {
        const t = doc.sliceString(n.from, n.to);
        const m = t.match(/^!\[([^\]]*)\]\(([^)]*)\)/);
        if (m) { decos.push(Decoration.replace({ widget: new ImageWidget(m[2], m[1], false, opts) }).range(n.from, n.to)); taken.push([n.from, n.to]); }
        return false;
      }
    },
  });

  const text = doc.sliceString(b.from, b.to);
  const inCode = (p: number) => codeRanges.some(([a, z]) => p >= a && p < z);
  const scan = (re: RegExp, fn: (m: RegExpExecArray, from: number) => void) => {
    re.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = re.exec(text))) {
      const from = b.from + m.index;
      if (!inCode(from)) fn(m, from);
    }
  };

  // CriticMarkup 批注 {==原文==}{>>批注<<}
  scan(/\{==([\s\S]+?)==\}\{>>([\s\S]*?)<<\}/g, (m, from) => {
    const innerFrom = from + 3, innerTo = innerFrom + m[1].length, end = from + m[0].length;
    decos.push(Decoration.mark({ class: "hm-anno", attributes: { "data-note-at": String(from) } }).range(innerFrom, innerTo));
    if (active) {
      decos.push(markCls("hm-anno-mark").range(from, innerFrom));
      decos.push(markCls("hm-anno-mark").range(innerTo, end));
    } else if (free(from, innerFrom) && free(innerTo, end)) {
      decos.push(hide.range(from, innerFrom));
      decos.push(hide.range(innerTo, end));
      taken.push([from, innerFrom], [innerTo, end]);
    }
  });
  // 文献引用 [@key]
  scan(/\[@([\w:-]+)\]/g, (m, from) => {
    const to = from + m[0].length;
    if (active) decos.push(markCls("hm-cite-src").range(from, to));
    else if (free(from, to)) { decos.push(Decoration.replace({ widget: new CiteWidget(m[1], opts.citeLabel(m[1])) }).range(from, to)); taken.push([from, to]); }
  });
  // 行内公式 $...$
  scan(/(^|[^\\$])\$([^$\n]+?)\$(?!\$)/g, (m, from0) => {
    const from = from0 + m[1].length, to = from + m[2].length + 2;
    if (active) decos.push(markCls("hm-math-src").range(from, to));
    else if (free(from, to)) { decos.push(Decoration.replace({ widget: new MathWidget(m[2], false) }).range(from, to)); taken.push([from, to]); }
  });
}

/* ---------- 改动高亮：外部修改或恢复版本后，变动的行铺一层绿色再慢慢褪去 ---------- */
export const flashLines = StateEffect.define<number[]>();
const clearFlash = StateEffect.define<null>();
const flashField = StateField.define<DecorationSet>({
  create: () => Decoration.none,
  update(v, tr) {
    v = v.map(tr.changes);
    for (const e of tr.effects) {
      if (e.is(clearFlash)) v = Decoration.none;
      if (e.is(flashLines)) {
        const doc = tr.state.doc;
        v = Decoration.set(e.value.filter((n) => n >= 1 && n <= doc.lines).map((n) => lineCls("hm-flash").range(doc.line(n).from)), true);
      }
    }
    return v;
  },
  provide: (f) => EditorView.decorations.from(f),
});
export function flash(view: EditorView, lines: number[]) {
  view.dispatch({ effects: flashLines.of(lines) });
  window.setTimeout(() => view.dispatch({ effects: clearFlash.of(null) }), 1400);
}

export function livePreview(opts: PreviewOptions): Extension {
  const memo = newMemo();
  const field = StateField.define<DecorationSet>({
    create: (s) => build(s, opts, memo),
    update(value, tr) {
      if (tr.docChanged || tr.selection || tr.effects.length || syntaxTree(tr.state) !== syntaxTree(tr.startState)) return build(tr.state, opts, memo, { value, changes: tr.changes });
      return value;
    },
    provide: (f) => EditorView.decorations.from(f),
  });
  return [focusField, field, flashField, EditorView.focusChangeEffect.of((_s, focusing) => setFocus.of(focusing))];
}
