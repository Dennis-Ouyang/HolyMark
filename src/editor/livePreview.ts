/**
 * 实时预览：光标所在的块显示 Markdown 源码，其余块隐藏语法符号、渲染公式/表格/图表/图片。
 * 思路与 Obsidian 的 Live Preview 相同：文档始终是纯文本，渲染只是装饰（decoration），不会改写文件。
 */
import { EditorState, Extension, Range, StateEffect, StateField } from "@codemirror/state";
import { Decoration, DecorationSet, EditorView, WidgetType } from "@codemirror/view";
import { syntaxTree } from "@codemirror/language";
import type { SyntaxNode } from "@lezer/common";
import katex from "katex";

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

class TableWidget extends WidgetType {
  constructor(readonly src: string, readonly opts: PreviewOptions) { super(); }
  eq(o: TableWidget) { return o.src === this.src; }
  toDOM(view: EditorView) {
    const wrap = document.createElement("div");
    wrap.className = "hm-table";
    const rows = this.src.split("\n").filter((l) => l.trim());
    const cells = (l: string) => l.trim().replace(/^\||\|$/g, "").split("|").map((c) => c.trim());
    const table = document.createElement("table");
    rows.forEach((line, i) => {
      if (i === 1 && /^\s*\|?\s*:?-{2,}/.test(line)) return;
      const tr = document.createElement("tr");
      cells(line).forEach((c) => {
        const td = document.createElement(i === 0 ? "th" : "td");
        td.innerHTML = renderInlineHTML(c, this.opts);
        tr.appendChild(td);
      });
      table.appendChild(tr);
    });
    wrap.appendChild(table);
    wrap.addEventListener("mousedown", (e) => focusAt(view, wrap, e, 2));
    return wrap;
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
    el.textContent = this.checked ? "✓" : "";
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
  let start = 1;
  if (doc.lines >= 2 && doc.line(1).text === "---") {
    for (let i = 2; i <= doc.lines; i++) {
      if (/^(---|\.\.\.)\s*$/.test(doc.line(i).text)) {
        out.push({ from: 0, to: doc.line(i).to, kind: "frontmatter" });
        start = i + 1;
        break;
      }
    }
  }
  const tree = syntaxTree(state);
  for (let i = start; i <= doc.lines; i++) {
    const line = doc.line(i);
    const t = line.text.trim();
    if (!t.startsWith("$$")) continue;
    const inCode = tree.resolveInner(line.from, 1);
    let n: SyntaxNode | null = inCode;
    let code = false;
    while (n) { if (FENCE_LIKE.has(n.name)) { code = true; break; } n = n.parent; }
    if (code) continue;
    if (t.length > 4 && t.endsWith("$$")) { out.push({ from: line.from, to: line.to, kind: "math" }); continue; }
    if (t !== "$$") continue;
    for (let j = i + 1; j <= doc.lines; j++) {
      if (doc.line(j).text.trim() === "$$") {
        out.push({ from: line.from, to: doc.line(j).to, kind: "math" });
        i = j;
        break;
      }
    }
  }
  return out;
}

export function topBlocks(state: EditorState): Block[] {
  const custom = customBlocks(state);
  const out: Block[] = [...custom];
  const overlaps = (f: number, t: number) => custom.some((c) => f <= c.to && t >= c.from);
  let child = syntaxTree(state).topNode.firstChild;
  while (child) {
    if (!overlaps(child.from, child.to)) out.push({ from: child.from, to: child.to, kind: child.name, node: child });
    child = child.nextSibling;
  }
  return out.sort((a, b) => a.from - b.from);
}

/* ---------------- decoration builder ---------------- */

const hide = Decoration.replace({});
const lineCls = (cls: string) => Decoration.line({ class: cls });
const markCls = (cls: string) => Decoration.mark({ class: cls });

/** 编辑器有焦点时才把光标所在块显示为源码；刚打开文件、焦点在别处时整篇都按格式显示 */
const setFocus = StateEffect.define<boolean>();
const focusField = StateField.define<boolean>({
  create: () => false,
  update: (v, tr) => { for (const e of tr.effects) if (e.is(setFocus)) return e.value; return v; },
});

function build(state: EditorState, opts: PreviewOptions): DecorationSet {
  const always = opts.syntax() === "always";
  const focused = state.field(focusField, false) ?? false;
  const decos: Range<Decoration>[] = [];
  const doc = state.doc;
  const sel = state.selection.ranges;
  const blocks = topBlocks(state);
  const isActive = (b: Block) => always || (focused && sel.some((r) => r.from <= b.to && r.to >= b.from));

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

  for (const b of blocks) {
    const active = isActive(b);
    const text = doc.sliceString(b.from, b.to);

    if (b.kind === "frontmatter") {
      if (active) linesOf(b, "hm-src-mono");
      else blockReplace(b, new FrontMatterWidget(text.replace(/^---\n?|\n?---\s*$/g, "")));
      continue;
    }
    if (b.kind === "math") {
      const tex = text.trim().replace(/^\$\$/, "").replace(/\$\$$/, "").trim();
      if (active) linesOf(b, "hm-src-mono");
      else blockReplace(b, new MathWidget(tex, true));
      continue;
    }
    if (b.kind === "FencedCode") {
      const info = (b.node!.getChild("CodeInfo") && doc.sliceString(b.node!.getChild("CodeInfo")!.from, b.node!.getChild("CodeInfo")!.to)) || "";
      if (!active && info.trim() === "mermaid") {
        blockReplace(b, new MermaidWidget(text.replace(/^```mermaid\s*\n?/, "").replace(/\n?```\s*$/, "")));
        continue;
      }
      linesOf(b, (_n, i, last) => "hm-code" + (i === 0 ? " hm-code-first" : "") + (last ? " hm-code-last" : ""));
      if (!active) {
        const first = doc.lineAt(b.from), last = doc.lineAt(b.to);
        decos.push(Decoration.replace({ widget: new TextWidget(info.trim() || "代码", "hm-code-lang") }).range(first.from, first.to));
        if (last.number !== first.number && /^\s*```/.test(last.text)) decos.push(hide.range(last.from, last.to));
      }
      continue;
    }
    if (b.kind === "Table") {
      if (active) linesOf(b, "hm-src-mono");
      else blockReplace(b, new TableWidget(text, opts));
      continue;
    }
    if (b.kind === "HorizontalRule") {
      if (!active) decos.push(Decoration.replace({ widget: new TextWidget("", "hm-hr") }).range(b.from, b.to));
      continue;
    }
    // 只有一张图片的段落：显示为带图注的插图
    if (b.kind === "Paragraph" && /^!\[[^\]]*\]\([^)]*\)\s*$/.test(text)) {
      if (!active) {
        const m = text.match(/^!\[([^\]]*)\]\(([^)]*)\)/)!;
        blockReplace(b, new ImageWidget(m[2], m[1], true, opts));
      }
      continue;
    }
    if (/^ATXHeading(\d)/.test(b.kind)) {
      const lv = Math.min(3, +b.kind.slice(-1));
      decos.push(lineCls(`hm-h hm-h${lv}`).range(doc.lineAt(b.from).from));
    }
    if (b.kind === "Blockquote") linesOf(b, "hm-quote");
    if (b.kind === "BulletList" || b.kind === "OrderedList") linesOf(b, "hm-list");
    inlineDecos(state, b, active, decos, opts);
  }
  return Decoration.set(decos, true);
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

export function livePreview(opts: PreviewOptions): Extension {
  const field = StateField.define<DecorationSet>({
    create: (s) => build(s, opts),
    update(value, tr) {
      if (tr.docChanged || tr.selection || tr.effects.length || syntaxTree(tr.state) !== syntaxTree(tr.startState)) return build(tr.state, opts);
      return value;
    },
    provide: (f) => EditorView.decorations.from(f),
  });
  return [focusField, field, EditorView.focusChangeEffect.of((_s, focusing) => setFocus.of(focusing))];
}
