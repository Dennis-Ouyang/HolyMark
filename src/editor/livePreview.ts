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
import { iconSvg } from "../lib/icons";
import { openNote, parseBody } from "./notes";

const NOTE_SCAN = /\{==([\s\S]+?)==\}\{>>([\s\S]*?)<<\}/g;
import { FileCardWidget, FileHooks } from "./fileCard";
import { CARD_EXT } from "../lib/filePreview";
import { isReading } from "./readingMode";
import { HEADING_ATTR } from "../lib/markdown";
import { isLocalHref, links, LinkHooks } from "./links";
import { listFolds, listRendered, lists, renderList } from "./lists";
import { FN_REF, footnoteDecos } from "./footnotes";
import { atCite } from "./atCite";

export interface PreviewOptions {
  /** 把文档里的图片路径解析成可显示的地址 */
  resolveImage: (src: string) => string;
  /** 把 [@key; @key2] 显示成什么，例如「（张伟，2021）」（和导出预览一致） */
  citeLabel: (keys: string[]) => string;
  /** 悬停引用时显示的文献信息 */
  citeInfo?: (key: string) => { author: string; year: string; title: string; venue?: string } | undefined;
  /** 语法显示方式：只在光标所在块显示，或始终显示 */
  syntax: () => "active" | "always";
  /** 单独成段的文件链接显示成预览卡片（不给就按普通链接显示） */
  files?: FileHooks;
  /** ⌘ / Ctrl + 点击打开链接（见 links.ts） */
  links?: LinkHooks;
  /** 正文里打 @ 时弹出文献（见 atCite.ts）；返回是否弹出了 */
  onAtCite?: (pos: number) => boolean;
}

interface Block {
  from: number;
  to: number;
  kind: string;
  node?: SyntaxNode;
}

/* ---------------- widgets ---------------- */

function focusAt(view: EditorView, dom: HTMLElement, e: Event, offset = 0) {
  if (isReading(view.state)) return; // 阅读模式：点哪里都不切成源码，留给浏览器选文字
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
      // 标签用纯 SVG 文字：mermaid 10.9 + dompurify 3.5 在 strict 下会把 HTML 标签里的文字清掉（和导出一致，见 mermaidImage.ts）
      mermaid.initialize({ startOnLoad: false, theme: dark ? "dark" : "neutral", securityLevel: "strict", htmlLabels: false, flowchart: { htmlLabels: false } });
      try {
        const { svg } = await mermaid.render("hm-mm-" + ++mermaidSeq, this.code);
        el.innerHTML = svg;
      } catch {
        el.textContent = "Mermaid 语法有误，点击来修改";
      }
    });
    el.addEventListener("mousedown", (e) => focusAt(view, el, e, 11));
    return el;
  }
  ignoreEvent() { return false; }
}

/** 属性区常见键名的中文：给读者看的是「标题」「文献库」，不是 title、bibliography */
const PROP_NAMES: Record<string, string> = {
  title: "标题", subtitle: "副标题", author: "作者", date: "日期", abstract: "摘要", keywords: "关键词", tags: "标签",
  bibliography: "文献库", csl: "引用样式", lang: "语言", toc: "目录", "toc-depth": "目录层级", numbersections: "章节编号",
  papersize: "纸张", geometry: "页边距", fontsize: "字号", mainfont: "西文字体", CJKmainfont: "中文字体", linestretch: "行距",
  "reference-doc": "参考文档", holymark: "本文显示", "heading-font": "标题字体", "body-font": "正文字体", "font-size": "字号",
  "line-height": "行距", measure: "版心宽度", description: "说明", category: "分类", status: "状态",
};
/** 展开过的属性区（按内容记），重画时保持展开 */
const openProps = new Set<string>();

/**
 * 属性区（YAML）：默认收成一行安静的「属性」和键名摘要，点开才显示全部（F7）。
 * 键名显示中文；分隔用间距，不用虚线。点某一项的值进入源码编辑。
 */
class FrontMatterWidget extends WidgetType {
  constructor(readonly yaml: string) { super(); }
  eq(o: FrontMatterWidget) { return o.yaml === this.yaml; }
  toDOM(view: EditorView) {
    const el = document.createElement("div");
    el.className = "hm-props" + (openProps.has(this.yaml) ? " open" : "");
    const rows: [string, string, boolean][] = [];
    for (const line of this.yaml.split("\n")) {
      const m = line.match(/^([\w-]+):\s*(.*)$/);
      const sub = line.match(/^\s+([\w-]+):\s*(.+)$/);
      const item = line.match(/^\s+-\s+(.+)$/);
      if (m) rows.push([m[1], m[2].replace(/^["']|["']$/g, ""), false]);
      else if (sub) rows.push([sub[1], sub[2].replace(/^["']|["']$/g, ""), true]);
      else if (item && rows.length) rows[rows.length - 1][1] += (rows[rows.length - 1][1] ? "、" : "") + item[1].replace(/^["']|["']$/g, "");
    }
    const head = document.createElement("button");
    head.type = "button";
    head.className = "hp-h";
    const tri = document.createElement("span");
    tri.className = "tri";
    tri.innerHTML = '<svg width="10" height="10" viewBox="0 0 16 16" fill="currentColor"><path d="M5 3.5 11 8l-6 4.5z"/></svg>';
    const lab = document.createElement("span");
    lab.className = "lab";
    lab.textContent = "属性";
    const sum = document.createElement("span");
    sum.className = "sum";
    sum.textContent = rows.filter((x) => !x[2]).map(([k]) => PROP_NAMES[k] || k).join("　");
    head.append(tri, lab, sum);
    head.addEventListener("mousedown", (e) => e.preventDefault());
    head.addEventListener("click", () => {
      const open = !el.classList.contains("open");
      el.classList.toggle("open", open);
      if (open) openProps.add(this.yaml); else openProps.delete(this.yaml);
      view.requestMeasure();
    });
    const list = document.createElement("dl");
    for (const [k, v, sub] of rows) {
      const dt = document.createElement("dt");
      dt.textContent = PROP_NAMES[k] || k;
      dt.title = k;
      if (sub) dt.className = "sub";
      const dd = document.createElement("dd");
      dd.textContent = v || "—";
      dd.addEventListener("mousedown", (e) => focusAt(view, el, e, 4));
      list.append(dt, dd);
    }
    el.append(head, list);
    return el;
  }
  ignoreEvent() { return true; }
}

/** 代码块第一行（``` 那一行）：右上角写语言，悬停整个代码块时出现「复制」 */
class CodeHeadWidget extends WidgetType {
  constructor(readonly lang: string, readonly code: string) { super(); }
  eq(o: CodeHeadWidget) { return o.lang === this.lang && o.code === this.code; }
  toDOM() {
    const el = document.createElement("span");
    el.className = "hm-code-head";
    const lang = document.createElement("span");
    lang.className = "hm-code-lang";
    lang.textContent = this.lang;
    const copy = document.createElement("button");
    copy.type = "button";
    copy.className = "hm-code-copy";
    copy.textContent = "复制";
    copy.addEventListener("mousedown", (e) => { e.preventDefault(); e.stopPropagation(); });
    copy.addEventListener("click", (e) => {
      e.stopPropagation();
      navigator.clipboard?.writeText(this.code).then(() => { copy.textContent = "已复制"; setTimeout(() => { copy.textContent = "复制"; }, 1200); }).catch(() => {});
    });
    el.append(lang, copy);
    return el;
  }
  ignoreEvent() { return true; }
}

/** 图片宽度写在 Pandoc 的属性里：![说明](图.png){width=60%}；返回改好宽度的源码，width 为空表示去掉 */
export function setImageWidth(src: string, width: string): string {
  const m = src.match(/^(\s*!\[[^\]]*\]\([^)]*\))(\{([^}]*)\})?(.*)$/s);
  if (!m) return src;
  const attrs = (m[3] || "").split(/\s+/).filter((x) => x && !/^width=/.test(x));
  if (width) attrs.unshift(`width=${width}`);
  return m[1] + (attrs.length ? `{${attrs.join(" ")}}` : "") + m[4];
}
export const imageWidth = (attrs: string) => attrs.match(/(?:^|\s)width=([^\s}]+)/)?.[1] ?? "";

/** 改完宽度后新画出来的图片要接着显示控制条 */
let reopenImage = "";

class ImageWidget extends WidgetType {
  constructor(readonly src: string, readonly alt: string, readonly block: boolean, readonly opts: PreviewOptions, readonly width = "") { super(); }
  eq(o: ImageWidget) { return o.src === this.src && o.alt === this.alt && o.block === this.block && o.width === this.width; }
  toDOM(view: EditorView) {
    const el = document.createElement(this.block ? "figure" : "span");
    el.className = this.block ? "hm-figure" : "hm-img-inline";
    const img = document.createElement("img");
    img.src = this.opts.resolveImage(this.src);
    img.alt = this.alt;
    img.draggable = false;
    img.onerror = () => { el.classList.add("missing"); el.setAttribute("data-missing", `找不到图片 ${this.src}`); };
    // 块级图片包在一个贴着图片本身的盒子里：选中框、缩放手柄、工具条都贴着图片，不是整栏宽（B12）
    const box = document.createElement("span");
    box.className = this.block ? "hm-imgbox" : "";
    if (this.width) (this.block ? box : img).style.width = /^\d+(\.\d+)?$/.test(this.width) ? this.width + "px" : this.width;
    if (this.block) { box.appendChild(img); el.appendChild(box); } else el.appendChild(img);
    if (this.block && this.alt) {
      const cap = document.createElement("figcaption");
      cap.textContent = this.alt;
      el.appendChild(cap);
    }
    if (!this.block) {
      el.addEventListener("mousedown", (e) => focusAt(view, el, e, 2));
      return el;
    }
    // 块级图片：点一下先出控制条（缩放、源代码），不直接切到源码
    const bar = document.createElement("div");
    bar.className = "hm-itools";
    bar.setAttribute("role", "toolbar");
    bar.setAttribute("aria-label", "图片");
    // 拖动缩放时的读数，只在拖的时候出现（平时宽度由按钮的选中状态表达，不再重复写一遍）
    const label = document.createElement("span");
    label.className = "hm-iw";
    const sizes: [string, string][] = [["25%", "25%"], ["50%", "50%"], ["75%", "75%"], ["100%", "100%"], ["", "原始大小"]];
    const btn = (text: string, title: string, run: () => void, cls = "") => {
      const b = document.createElement("button");
      b.type = "button"; b.textContent = text; b.title = title; if (cls) b.className = cls;
      b.addEventListener("mousedown", (e) => { e.preventDefault(); e.stopPropagation(); });
      b.addEventListener("click", (e) => { e.stopPropagation(); run(); });
      return b;
    };
    for (const [w, t] of sizes) bar.appendChild(btn(t, w ? `宽度设为版心的 ${w}` : "按图片本身的大小显示", () => commit(w), w === this.width ? "on" : ""));
    const sep = document.createElement("span"); sep.className = "sep"; bar.appendChild(sep);
    bar.appendChild(btn("源代码", "显示源代码", () => { close(); focusAt(view, el, new Event("x"), 2); }, "src"));
    const grip = document.createElement("span");
    grip.className = "hm-igrip";
    grip.title = "拖动缩放";
    grip.innerHTML = iconSvg("resize", 12);
    box.append(bar, grip, label);

    const commit = (w: string) => {
      const from = view.posAtDOM(el);
      const line = view.state.doc.lineAt(from);
      const next = setImageWidth(line.text, w);
      if (next === line.text) return;
      reopenImage = this.src;
      view.dispatch({ changes: { from: line.from, to: line.to, insert: next } });
    };
    const outside = (e: MouseEvent) => { if (!el.contains(e.target as Node)) close(); };
    const open = () => {
      el.classList.add("editing");
      addEventListener("mousedown", outside, true);
    };
    const close = () => { el.classList.remove("editing"); removeEventListener("mousedown", outside, true); };
    el.addEventListener("mousedown", (e) => {
      if ((e.target as HTMLElement).closest(".hm-itools, .hm-igrip")) return;
      e.preventDefault();
      if (el.classList.contains("editing")) return;
      open();
    });
    el.addEventListener("dblclick", (e) => { if (!(e.target as HTMLElement).closest(".hm-itools, .hm-igrip")) { close(); focusAt(view, el, e, 2); } });
    grip.addEventListener("mousedown", (e) => {
      e.preventDefault(); e.stopPropagation();
      const full = el.clientWidth;
      const x0 = e.clientX, w0 = box.getBoundingClientRect().width;
      let pct = Math.round((w0 / full) * 100);
      el.classList.add("resizing");
      const move = (ev: MouseEvent) => {
        // 图片居中，往右拖一像素两边各长一像素
        pct = Math.max(10, Math.min(100, Math.round(((w0 + 2 * (ev.clientX - x0)) / full) * 100)));
        box.style.width = pct + "%";
        label.textContent = pct + "%";
      };
      const up = () => { removeEventListener("mousemove", move); removeEventListener("mouseup", up); el.classList.remove("resizing"); commit(pct + "%"); };
      addEventListener("mousemove", move);
      addEventListener("mouseup", up);
    });
    if (reopenImage === this.src) { reopenImage = ""; requestAnimationFrame(open); }
    return el;
  }
  ignoreEvent() { return true; }
}

/**
 * 批注的页边圆点：替换掉藏起来的 ==}{>>…<<}，本身零宽、不占行内位置（不会把后面的「。」挤到行首），
 * 里面的小圆点绝对定位到这一行右侧的页边、纵向停在原文所在的那一行。点圆点打开批注浮层。
 */
class NoteMarkWidget extends WidgetType {
  constructor(readonly empty: boolean) { super(); }
  eq(o: NoteMarkWidget) { return o.empty === this.empty; }
  toDOM(view: EditorView) {
    const el = document.createElement("span");
    el.className = "hm-notemark";
    const dot = document.createElement("i");
    dot.className = this.empty ? "empty" : "";
    dot.title = "查看批注";
    dot.addEventListener("mousedown", (e) => {
      e.preventDefault();
      const pos = view.posAtDOM(el); // 替换的是 ==}{>>…<<}，起点就是原文的末尾
      view.dispatch({ selection: { anchor: pos }, effects: openNote.of({ pos, focus: false }) });
      view.focus();
    });
    el.append(dot);
    return el;
  }
  ignoreEvent() { return true; }
}

/** 文献引用小标签：显示成导出后的样子「（张伟，2021）」；悬停浮出作者、年份、题名（F8） */
let citeTip: HTMLElement | null = null;
class CiteWidget extends WidgetType {
  constructor(readonly keys: string[], readonly label: string, readonly info?: PreviewOptions["citeInfo"]) { super(); }
  eq(o: CiteWidget) { return o.keys.join(";") === this.keys.join(";") && o.label === this.label; }
  toDOM(view: EditorView) {
    const el = document.createElement("span");
    el.className = "hm-cite";
    el.textContent = this.label;
    el.addEventListener("mousedown", (e) => focusAt(view, el, e, 1));
    let t = 0;
    el.addEventListener("mouseenter", () => { t = window.setTimeout(() => showCiteTip(el, this.keys, this.info), 400); });
    el.addEventListener("mouseleave", () => { clearTimeout(t); hideCiteTip(); });
    return el;
  }
  destroy() { hideCiteTip(); }
  ignoreEvent() { return false; }
}
function showCiteTip(anchor: HTMLElement, keys: string[], info?: PreviewOptions["citeInfo"]) {
  hideCiteTip();
  const box = document.createElement("div");
  box.className = "hm-citetip";
  for (const k of keys) {
    const b = info?.(k);
    const row = document.createElement("div");
    row.className = "ct-r";
    const ti = document.createElement("div");
    ti.className = "ct-t";
    ti.textContent = b ? b.title : `文献库里没有 @${k}`;
    if (!b) ti.className = "ct-t miss";
    row.append(ti);
    if (b) {
      const by = document.createElement("div");
      by.className = "ct-b";
      const au = document.createElement("span"); au.textContent = b.author.replace(/\s+and\s+/g, "，");
      const yr = document.createElement("span"); yr.className = "y"; yr.textContent = b.year;
      by.append(au, yr);
      row.append(by);
      // 出处（期刊、会议、出版社）：阅读时想知道发在哪
      if (b.venue) { const v = document.createElement("div"); v.className = "ct-v"; v.textContent = b.venue; row.append(v); }
    }
    box.append(row);
  }
  document.body.append(box);
  const r = anchor.getBoundingClientRect(), br = box.getBoundingClientRect();
  const below = r.bottom + 6 + br.height < innerHeight - 8;
  box.style.left = Math.round(Math.max(8, Math.min(r.left, innerWidth - br.width - 8))) + "px";
  box.style.top = Math.round(below ? r.bottom + 6 : r.top - 6 - br.height) + "px";
  citeTip = box;
}
function hideCiteTip() { citeTip?.remove(); citeTip = null; }

/** 勾掉最后一个子项时，父项闪亮一下 */
function glowParentIfDone(view: EditorView, pos: number) {
  const st = view.state;
  let n: SyntaxNode | null = syntaxTree(st).resolveInner(pos, 1);
  while (n && n.name !== "ListItem") n = n.parent;
  const parent = n?.parent?.parent; // ListItem → 列表 → 父 ListItem
  if (!parent || parent.name !== "ListItem" || !parent.getChild("Task")) return;
  let total = 0, done = 0;
  for (const k of [...parent.getChildren("BulletList"), ...parent.getChildren("OrderedList")]) k.cursor().iterate((c) => {
    if (c.name !== "TaskMarker") return;
    total++;
    if (/x/i.test(st.sliceDoc(c.from, c.to))) done++;
  });
  if (total && done === total) {
    const line = st.doc.lineAt(parent.from).number;
    view.dispatch({ effects: glowLine.of(line) });
    window.setTimeout(() => view.dispatch({ effects: glowLine.of(0) }), 1100);
  }
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
      if (!this.checked) glowParentIfDone(view, pos);
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
  h = h.replace(/\[(@[\w:.-]+(?:\s*;\s*@[\w:.-]+)*)\]/g, (_m, inner: string) => `<span class="hm-cite">${esc(opts.citeLabel(inner.split(";").map((k) => k.trim().slice(1))))}</span>`);
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
interface Zone { zone: number; base: number; end: number; sig: string; block: Block; active: boolean; gap: number; gapLine: number; extra: string }
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
  // 阅读模式（N2）：整篇都按格式显示，不管光标在哪、设置是不是「始终显示符号」
  const reading = isReading(state);
  const touches = (b: Block) => focused && sel.some((r) => r.from <= b.to && r.to >= b.from);
  const isList = (b: Block) => b.kind === "BulletList" || b.kind === "OrderedList";
  // 列表光标进入时仍保持渲染，只有「显示源代码」时才显示源码（见 lists.ts）
  const isActive = (b: Block) => !reading && (always || (isList(b) ? !listRendered(state, doc.lineAt(b.from).from, false) && touches(b) : touches(b)));
  const folds = state.field(listFolds, false) ?? [];
  /** 渲染状态的列表：光标在哪几行、哪几项折叠了（块内行号），变了就要重算这一块 */
  const extraOf = (b: Block, active: boolean): string => {
    if (!isList(b) || active) return "";
    const a = doc.lineAt(b.from).number, z = doc.lineAt(b.to).number;
    const cur: number[] = [];
    if (focused && !reading) for (const r of sel) if (r.from <= b.to && r.to >= b.from) {
      for (let n = doc.lineAt(Math.max(r.from, b.from)).number, e = doc.lineAt(Math.min(r.to, b.to)).number; n <= e; n++) cur.push(n - a);
    }
    const fl: number[] = [];
    for (const f of folds) if (f >= b.from && f <= b.to) fl.push(doc.lineAt(f).number - a);
    return cur.length || fl.length ? `c${cur.join(",")}f${fl.join(",")}z${z - a}` : "";
  };
  /** 段间空行上有光标时按正常行高显示，光标才有完整的高度；光标离开后再收窄成段距 */
  const gapShown = (line: number) => line >= 0 && !(focused && !reading && sel.some((r) => r.empty && r.head === line));

  /** 第 j 块的区段信息（要查行号，只对变了的块调用） */
  const zoneOf = (j: number, active: boolean, extra: string): Zone => {
    const b = blocks[j];
    const startLine = doc.lineAt(b.from), endLine = doc.lineAt(b.to);
    const prevEnd = j ? doc.lineAt(blocks[j - 1].to).number : 0; // 上一块最后一行的行号
    const zone = prevEnd ? doc.line(prevEnd + 1).from : 0;
    // 段落之间只隔一个空行时，这个空行收窄成段距（光标停在这一行上时除外）；连续多个空行按正常行高显示
    let gapLine = -1;
    if (prevEnd && startLine.number - prevEnd === 2) {
      const g = doc.line(prevEnd + 1);
      if (!g.text.trim() && doc.line(prevEnd).text.trim() && startLine.text.trim()) gapLine = g.from;
    }
    const gap = gapShown(gapLine) ? gapLine : -1;
    const base = startLine.from;
    const sig = `${b.kind}|${active ? 1 : 0}|${gap < 0 ? 0 : 1}|${base - zone}|${b.from - base}|${b.to - base}|${endLine.to - base}|${extra}`;
    return { zone, base, end: endLine.to, sig, block: b, active, gap, gapLine, extra };
  };

  const decosOf = (z: Zone, next: Map<string, Local>): Range<Decoration>[] => {
    const out: Range<Decoration>[] = [];
    if (z.gap >= 0) out.push(lineCls("hm-gap").range(z.gap));
    const key = `${z.sig}|${doc.sliceString(z.base, z.end)}`;
    let local = next.get(key) ?? memo.cache.get(key);
    if (!local) {
      const abs: Range<Decoration>[] = [];
      blockDecos(state, z.block, z.active, abs, opts, z.extra);
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
      const extra = extraOf(b, active);
      const o = matched >= 0 ? old[matched] : null;
      const gapLine = o && o.gapLine >= 0 ? map(o.gapLine) : -1;
      if (o && (j === 0 ? matched === 0 : prevMatched === matched - 1) && o.active === active && o.extra === extra && gapShown(gapLine) === o.gap >= 0) {
        zones[j] = ch.empty ? { ...o, block: b } : { ...o, block: b, zone: map(o.zone), base: map(o.base), end: map(o.end), gap: o.gap < 0 ? -1 : map(o.gap), gapLine };
      } else {
        zones[j] = zoneOf(j, active, extra);
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
  const zones = blocks.map((b, j) => { const act = isActive(b); return zoneOf(j, act, extraOf(b, act)); });
  const next = new Map<string, Local>();
  const out: Range<Decoration>[] = [];
  for (const z of zones) for (const r of decosOf(z, next)) out.push(r);
  memo.cache = next;
  memo.zones = zones;
  // 各区段的装饰本来就按顺序排好，这里的排序几乎是线性的
  return Decoration.set(out, true);
}

/** 一个块的全部装饰（绝对位置） */
function blockDecos(state: EditorState, b: Block, active: boolean, decos: Range<Decoration>[], opts: PreviewOptions, extra = "") {
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
    const first = doc.lineAt(b.from), last = doc.lineAt(b.to);
    const closed = last.number !== first.number && /^\s*(```|~~~)/.test(last.text);
    // 渲染状态下开头、结尾的 ``` 行都收窄成同样的高度，上下对称（以前结尾那行藏了字、行高还在，底部空出一整行）
    linesOf(b, (_n, i, isLast) => "hm-code" + (i === 0 ? " hm-code-first" : "") + (isLast ? " hm-code-last" : "") + (!active && (i === 0 || (isLast && closed)) ? " hm-code-fence" : ""));
    if (!active) {
      const code = doc.sliceString(Math.min(first.to + 1, b.to), closed ? Math.max(first.to + 1, last.from - 1) : b.to);
      decos.push(Decoration.replace({ widget: new CodeHeadWidget(info.trim() || "代码", code) }).range(first.from, first.to));
      if (closed) decos.push(hide.range(last.from, last.to));
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
  if (b.kind === "Paragraph" && /^!\[[^\]]*\]\([^)]*\)(\{[^}]*\})?\s*$/.test(text)) {
    if (!active) {
      const m = text.match(/^!\[([^\]]*)\]\(([^)]*)\)(\{([^}]*)\})?/)!;
      blockReplace(b, new ImageWidget(m[2], m[1], true, opts, imageWidth(m[4] || "")));
    }
    return;
  }
  // 只有一个文件链接的段落（PDF、Word、PPT、Excel、Markdown）：显示成纸张预览卡片
  if (b.kind === "Paragraph" && opts.files && !active) {
    const m = text.match(/^\[([^\]]*)\]\((<[^>]+>|[^)\s]+)\)\s*$/);
    if (m) {
      const href = m[2].replace(/^<|>$/g, "");
      let dec = href;
      try { dec = decodeURI(href); } catch { /* 原样用 */ }
      if (!/^[a-z][a-z0-9+.-]*:/i.test(href) && CARD_EXT.test(dec)) { blockReplace(b, new FileCardWidget(href, m[1], opts.files)); return; }
    }
  }
  // 段落里单独占一行的图片（和上一行之间没空行，Markdown 算同一段）：这一行也按插图显示，不缩成行内小图
  const skip: [number, number][] = [];
  if (b.kind === "Paragraph" && !active) {
    for (let n = doc.lineAt(b.from).number, z = doc.lineAt(b.to).number; n <= z; n++) {
      const line = doc.line(n);
      const m = line.text.match(/^\s*!\[([^\]]*)\]\(([^)]*)\)(\{([^}]*)\})?\s*$/);
      if (!m) continue;
      decos.push(Decoration.replace({ widget: new ImageWidget(m[2], m[1], true, opts, imageWidth(m[4] || "")), block: true }).range(line.from, line.to));
      skip.push([line.from, line.to]);
    }
  }
  if (/^ATXHeading(\d)/.test(b.kind)) {
    const lv = +b.kind.slice(-1);
    decos.push(lineCls(`hm-h hm-h${lv}`).range(doc.lineAt(b.from).from));
    // 标题末尾的 {#id}（N4 文内跳转用）：和其他符号一样，不在编辑这一行时藏起来
    const line = doc.lineAt(b.from), attr = !active && line.text.match(HEADING_ATTR);
    if (attr) decos.push(hide.range(line.from + attr.index!, line.to));
  }
  if (b.kind === "Blockquote") linesOf(b, "hm-quote");
  if (b.kind === "BulletList" || b.kind === "OrderedList") {
    if (active) { listDecos(state, b, decos); inlineDecos(state, b, active, decos, opts, skip); return; }
    // 渲染状态：符号、编号、勾选框都是部件，行内格式逐行处理（光标所在行显示源码）
    const em = extra.match(/^c([\d,]*)f([\d,]*)/);
    const nums = (x: string | undefined) => new Set((x || "").split(",").filter(Boolean).map(Number));
    renderList(state, b.from, b.to, { cursorLines: nums(em?.[1]), folded: nums(em?.[2]) }, decos,
      (from, to, act) => { if (to > from) inlineDecos(state, { from, to, kind: "ListLine" }, act, decos, opts, [], true); },
      (from, to) => {
        const t = state.doc.sliceString(from, to);
        const m = opts.files && t.match(/^\[([^\]]*)\]\((<[^>]+>|[^)\s]+)\)\s*$/);
        if (!m) return false;
        const href = m[2].replace(/^<|>$/g, "");
        let dec = href;
        try { dec = decodeURI(href); } catch { /* 原样用 */ }
        if (/^[a-z][a-z0-9+.-]*:/i.test(href) || !CARD_EXT.test(dec)) return false;
        decos.push(Decoration.replace({ widget: new FileCardWidget(href, m[1], opts.files!, true) }).range(from, to));
        return true;
      });
    return;
  }
  inlineDecos(state, b, active, decos, opts, skip);
}


/** 显示源代码时的列表：原样显示符号和缩进，只用等宽数字对齐 */
function listDecos(state: EditorState, b: Block, decos: Range<Decoration>[]) {
  const doc = state.doc;
  for (let n = doc.lineAt(b.from).number, z = doc.lineAt(b.to).number; n <= z; n++) decos.push(lineCls("hm-list-src").range(doc.line(n).from));
}

/** 行内：强调、代码、链接、图片、任务框、引用、公式、批注 */
function inlineDecos(state: EditorState, b: Block, active: boolean, decos: Range<Decoration>[], opts: PreviewOptions, skip: [number, number][] = [], inList = false) {
  const doc = state.doc;
  const codeRanges: [number, number][] = [];
  const taken: [number, number][] = [];
  const free = (f: number, t: number) => !taken.some(([a, z]) => f < z && t > a);
  const text = doc.sliceString(b.from, b.to);

  // 批注 {==原文==}{>>@作者 日期：内容<<}：不管光标在不在这一段，符号都藏起来（批注是图形化编辑的，见 notes.ts），
  // 原文高亮，后面一个小图标。先处理批注，免得批注内容里的符号被下面当成强调、链接再装饰一遍
  const code0: [number, number][] = [];
  syntaxTree(state).iterate({ from: b.from, to: b.to, enter: (n) => { if (n.name === "InlineCode") code0.push([n.from, n.to]); } });
  const hidden: [number, number][] = [];
  NOTE_SCAN.lastIndex = 0;
  for (let m: RegExpExecArray | null; (m = NOTE_SCAN.exec(text)); ) {
    const from = b.from + m.index;
    if (code0.some(([a, z]) => from >= a && from < z)) continue;
    const quoteFrom = from + 3, quoteTo = quoteFrom + m[1].length, end = from + m[0].length;
    decos.push(hide.range(from, quoteFrom));
    decos.push(Decoration.mark({ class: "hm-note", attributes: { "data-note-at": String(from) } }).range(quoteFrom, quoteTo));
    decos.push(Decoration.replace({ widget: new NoteMarkWidget(!parseBody(m[2]).text.trim()) }).range(quoteTo, end));
    decos.push(lineCls("hm-noteline").range(doc.lineAt(quoteTo).from));
    hidden.push([from, quoteFrom], [quoteTo, end]);
    taken.push([from, quoteFrom], [quoteTo, end]);
  }

  // 脚注 [^1] 和定义行 [^1]: 内容（G10）。先处理：上标语法 ^…^ 会把两个 [^ 之间的字当成上标
  const fnBefore = taken.length;
  footnoteDecos(state, b.from, b.to, active, decos, free, taken);
  const fnRanges = taken.slice(fnBefore);
  if (active) { FN_REF.lastIndex = 0; for (let m: RegExpExecArray | null; (m = FN_REF.exec(text)); ) fnRanges.push([b.from + m.index, b.from + m.index + m[0].length]); }

  syntaxTree(state).iterate({
    from: b.from,
    to: b.to,
    enter: (n) => {
      const name = n.name;
      if ((name === "Superscript" || name === "SuperscriptMark" || name === "Link") && fnRanges.some(([f, t]) => n.from < t && n.to > f)) return false;
      if (skip.some(([f, t]) => n.from >= f && n.to <= t)) return false; // 已经按插图整行替换掉了
      if (hidden.some(([f, t]) => n.from >= f && n.to <= t)) return false; // 藏起来的批注符号和内容
      if (name === "InlineCode") { codeRanges.push([n.from, n.to]); decos.push(markCls("hm-icode").range(n.from, n.to)); }
      if (name === "StrongEmphasis") decos.push(markCls("hm-strong").range(n.from, n.to));
      if (name === "Emphasis") decos.push(markCls("hm-em").range(n.from, n.to));
      if (name === "Strikethrough") decos.push(markCls("hm-strike").range(n.from, n.to));
      if (name === "Superscript") decos.push(markCls("hm-sup").range(n.from, n.to));
      if (name === "Subscript") decos.push(markCls("hm-sub").range(n.from, n.to));
      if (name === "Highlight") decos.push(markCls("hm-hl").range(n.from, n.to));
      // [@key] 是文献引用，不按链接处理
      if (name === "Link" && /^\[@[\w:-]+\]$/.test(doc.sliceString(n.from, n.to))) return false;
      // [^1] 是脚注（文末有 [^1]: 定义时 CommonMark 会把它当成引用式链接），交给 footnotes.ts
      if (name === "Link" && /^\[\^[^\]\s]+\]$/.test(doc.sliceString(n.from, n.to))) return false;
      if (name === "Link") {
        decos.push(markCls("hm-link").range(n.from, n.to));
        // 本机文件链接前加一个小文件图标，和网页链接区分开
        const u = n.node.getChild("URL");
        if (!active && u && isLocalHref(doc.sliceString(u.from, u.to))) decos.push(Decoration.widget({ widget: new TextWidget("", "hm-linkfile"), side: -1 }).range(n.from));
      }
      const marker = ["EmphasisMark", "CodeMark", "StrikethroughMark", "SuperscriptMark", "SubscriptMark", "HighlightMark", "LinkMark", "URL", "LinkTitle"].includes(name);
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
      if (inList && (name === "ListMark" || name === "TaskMarker")) return; // 列表符号由 lists.ts 渲染
      if (name === "ListMark" && !active) {
        const t = doc.sliceString(n.from, n.to);
        const task = /^\s?\[[ xX]\]/.test(doc.sliceString(n.to, n.to + 5));
        if (/^[-*+]$/.test(t)) {
          const end = doc.sliceString(n.to, n.to + 1) === " " ? n.to + 1 : n.to;
          decos.push(Decoration.replace({ widget: new TextWidget(task ? "" : "•", task ? "hm-bullet-none" : "hm-bullet") }).range(n.from, end));
          taken.push([n.from, end]);
        }
      } else if (name === "ListMark" && active) decos.push(markCls("hm-mark").range(n.from, n.to));
      if (name === "TaskMarker") {
        const checked = /x/i.test(doc.sliceString(n.from, n.to));
        const task = n.node.parent;
        if (checked && task && task.to > n.to + 1) decos.push(markCls("hm-done").range(n.to + 1, task.to));
      }
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

  const inCode = (p: number) => codeRanges.some(([a, z]) => p >= a && p < z);
  const scan = (re: RegExp, fn: (m: RegExpExecArray, from: number) => void) => {
    re.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = re.exec(text))) {
      const from = b.from + m.index;
      if (!inCode(from)) fn(m, from);
    }
  };

  // 文献引用 [@key]
  scan(/\[(@[\w:.-]+(?:\s*;\s*@[\w:.-]+)*)\]/g, (m, from) => {
    const to = from + m[0].length;
    const keys = m[1].split(";").map((k) => k.trim().slice(1));
    if (active) decos.push(markCls("hm-cite-src").range(from, to));
    else if (free(from, to)) { decos.push(Decoration.replace({ widget: new CiteWidget(keys, opts.citeLabel(keys), opts.citeInfo) }).range(from, to)); taken.push([from, to]); }
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
/** 闪亮某一行（行号），0 表示清除 */
const glowLine = StateEffect.define<number>();
const glowField = StateField.define<DecorationSet>({
  create: () => Decoration.none,
  update(v, tr) {
    v = v.map(tr.changes);
    for (const e of tr.effects) if (e.is(glowLine)) v = e.value > 0 && e.value <= tr.state.doc.lines ? Decoration.set([lineCls("hm-glow").range(tr.state.doc.line(e.value).from)]) : Decoration.none;
    return v;
  },
  provide: (f) => EditorView.decorations.from(f),
});
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
  // lists() 里的状态（显示源代码、折叠）要排在装饰前面：装饰重算时会读它们
  return [lists(() => opts.syntax() === "always"), focusField, field, flashField, glowField, EditorView.focusChangeEffect.of((_s, focusing) => setFocus.of(focusing)), opts.links ? links(opts.links) : [], opts.onAtCite ? atCite(opts.onAtCite) : []];
}
