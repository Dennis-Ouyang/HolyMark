/**
 * N8 通用块把手：把列表（C 节）的把手推广到其他块——段落、标题、引用、表格、图片、代码块、公式块、文件横条、分隔线。
 * - 悬停时块左侧出现把手（blockHandle.ts，和列表共用同一个把手）；拖动调整块的顺序，落点一条细线；
 *   拖动标题时整节（到下一个同级或更高级标题之前）一起移动，提示条带「撤销」。
 * - 点把手弹出菜单：转换类型（正文、标题 1–3、引用、无序列表）、在下方复制一份、复制内容、上移、下移、显示源代码；
 *   最下面细线隔开的「删除」（克制的红色）。
 * - 一次移动就是一步撤销。阅读模式里不出现。
 * 块的移动是纯函数（lib/blockMove.ts）；目录里拖动标题（SidePanel）也调这里的 moveSection。
 */
import type { EditorState, Extension } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { ensureSyntaxTree, syntaxTree } from "@codemirror/language";
import { undo } from "@codemirror/commands";
import { blockHandle, type HandleMenuItem, type HandleProvider, type HandleTarget } from "./blockHandle";
import { blockBefore, moveSpan, neighborSlot, nextBlockStart, Span, TopBlock, unitOf } from "../lib/blockMove";
import { BlockKind, setBlock } from "./commands";
import { notify } from "./notice";
import { isReading } from "./readingMode";

export type BlockType = "p" | "h" | "quote" | "code" | "math" | "table" | "img" | "file" | "hr" | "list" | "html" | "other";
export interface DocBlock extends TopBlock { type: BlockType }

const TYPE_NAME: Record<BlockType, string> = {
  p: "段落", h: "标题", quote: "引用", code: "代码块", math: "公式块", table: "表格", img: "图片", file: "文件", hr: "分隔线", list: "列表", html: "HTML", other: "块",
};

/* ---------------- 顶层块 ---------------- */

const cache = new WeakMap<object, DocBlock[]>();

/** 全文的顶层块（属性区不算；$$ 公式块里面有空行也算一块）。按文档缓存，正文改了才重算 */
export function docBlocks(state: EditorState, full = false): DocBlock[] {
  const tree = full ? ensureSyntaxTree(state, state.doc.length, 300) ?? syntaxTree(state) : syntaxTree(state);
  const key = state.doc;
  const hit = cache.get(key);
  if (hit && (!full || hit.length && tree.length >= state.doc.length)) return hit;
  const doc = state.doc;
  // 属性区、$$ 公式块的范围（不在 lezer 的语法里）
  const skip: Span[] = [], math: Span[] = [];
  if (doc.line(1).text === "---") {
    for (let i = 2; i <= doc.lines; i++) if (/^(---|\.\.\.)\s*$/.test(doc.line(i).text)) { skip.push({ from: 0, to: doc.line(i).to }); break; }
  }
  let open = -1;
  for (let i = 1; i <= doc.lines; i++) {
    const L = doc.line(i);
    if (skip.length && L.to <= skip[0].to) continue;
    const t = L.text.trim();
    if (open >= 0) { if (t === "$$") { math.push({ from: open, to: L.to }); open = -1; } continue; }
    if (t === "$$") {
      const n = tree.resolveInner(L.from, 1);
      let code = false;
      for (let x: typeof n | null = n; x; x = x.parent) if (x.name === "FencedCode" || x.name === "CodeBlock") code = true;
      if (!code) open = L.from;
    }
  }
  const out: DocBlock[] = [];
  for (let n = tree.topNode.firstChild; n; n = n.nextSibling) {
    if (skip.some((s) => n!.from < s.to)) continue;
    const m = math.find((s) => n!.from >= s.from && n!.from <= s.to);
    if (m) { if (!out.length || out[out.length - 1].from !== m.from) out.push({ from: m.from, to: m.to, level: 0, type: "math" }); continue; }
    const from = doc.lineAt(n.from).from, to = doc.lineAt(Math.max(n.from, n.to - (doc.sliceString(n.to - 1, n.to) === "\n" ? 1 : 0))).to;
    const name = n.name;
    let type: BlockType = "other", level = 0;
    const h = name.match(/^(?:ATX|Setext)Heading(\d)$/);
    if (h) { type = "h"; level = +h[1]; }
    else if (name === "Paragraph") {
      const t = doc.sliceString(from, to).trim();
      type = /^\$\$[\s\S]*\$\$$/.test(t) ? "math" : /^!\[[^\]]*\]\([^)]*\)(\{[^}]*\})?$/.test(t) ? "img" : /^\[[^\]]*\]\([^)]*\)$/.test(t) && !/^\[@/.test(t) ? "file" : "p";
    }
    else if (name === "Blockquote") type = "quote";
    else if (name === "FencedCode" || name === "CodeBlock") type = "code";
    else if (name === "Table") type = "table";
    else if (name === "HorizontalRule") type = "hr";
    else if (name === "BulletList" || name === "OrderedList") type = "list";
    else if (name === "HTMLBlock" || name === "CommentBlock") type = "html";
    else if (name === "LinkReference") continue;
    out.push({ from, to, level, type });
  }
  cache.set(key, out);
  return out;
}

function blockIndexAt(state: EditorState, pos: number, full = false): number {
  const bs = docBlocks(state, full);
  return bs.findIndex((b) => pos >= b.from && pos <= b.to);
}

/* ---------------- 动作 ---------------- */

const heading = (state: EditorState, b: TopBlock) => state.sliceDoc(b.from, b.to).replace(/^#{1,6}\s+/, "").replace(/\s*\{#[^}]*\}\s*$/, "").split("\n")[0].trim();

/** 把 unit 挪到 before 前面；标题带着整节，挪完弹提示条（带撤销）。返回挪动是否发生 */
export function moveUnitTo(view: EditorView, i: number, before: number): boolean {
  const st = view.state;
  const bs = docBlocks(st, true);
  const b = bs[i];
  if (!b) return false;
  const unit = unitOf(bs, i);
  const r = moveSpan(st.doc.toString(), unit, before);
  if (!r) return false;
  view.dispatch({ changes: { from: r.from, to: r.to, insert: r.insert }, selection: { anchor: r.at }, scrollIntoView: true, userEvent: "move.block" });
  if (b.level) {
    const prev = blockBefore(bs, before, unit);
    const name = heading(st, b);
    const next = bs.find((x) => x.from >= before && !(x.from >= unit.from && x.to <= unit.to));
    const where = prev ? `移到「${prev.level ? heading(st, prev) : clip(st.sliceDoc(prev.from, prev.to))}」之后` : next ? `移到「${next.level ? heading(st, next) : clip(st.sliceDoc(next.from, next.to))}」之前` : "移到最前面";
    notify(`已把「${name}」${where}`, "success", { label: "撤销", run: () => { undo(view); view.focus(); } });
  }
  return true;
}
const clip = (s: string) => { const t = s.replace(/\s+/g, " ").trim(); return t.length > 12 ? t.slice(0, 12) + "…" : t; };

/** 目录里拖动标题：把位置 headingPos 的那一节挪到 beforePos（另一个标题的开头，或全文末尾）前面 */
export function moveSection(view: EditorView, headingPos: number, beforePos: number): boolean {
  const i = blockIndexAt(view.state, headingPos, true);
  return i >= 0 && moveUnitTo(view, i, beforePos);
}

function convert(view: EditorView, b: DocBlock, kind: BlockKind) {
  view.dispatch({ selection: { anchor: b.from, head: b.to } });
  setBlock(view, kind);
}

function removeBlock(view: EditorView, b: DocBlock) {
  const text = view.state.doc.toString();
  const nxt = nextBlockStart(text, b.to);
  // 最后一块：连同前面的空行一起删；其他块：连同后面的空行
  const from = nxt >= text.length && b.from > 0 ? text.slice(0, b.from).replace(/\s+$/, "").length : b.from;
  const to = nxt >= text.length ? Math.max(b.to, text.replace(/\s+$/, "").length) : nxt;
  view.dispatch({ changes: { from, to }, selection: { anchor: Math.min(from, view.state.doc.length - (to - from)) }, userEvent: "delete.block" });
  notify("已删除", "success", { label: "撤销", run: () => { undo(view); view.focus(); } });
}

function menuFor(view: EditorView, i: number): HandleMenuItem[] {
  const st = view.state;
  const bs = docBlocks(st, true);
  const b = bs[i];
  const unit = unitOf(bs, i);
  const len = st.doc.length;
  const text = st.sliceDoc(unit.from, unit.to);
  const textual = b.type === "p" || b.type === "h" || b.type === "quote";
  const oneLine = !st.sliceDoc(b.from, b.to).includes("\n");
  const cur: BlockKind = b.type === "h" ? (`h${b.level}` as BlockKind) : b.type === "quote" ? "quote" : "p";
  const conv = (label: string, icon: string, k: BlockKind, ok = true): HandleMenuItem => ({ label, icon, disabled: cur === k || !ok, run: () => convert(view, b, k) });
  const up = neighborSlot(bs, i, -1, len), down = neighborSlot(bs, i, 1, len);
  return [
    ...(textual ? [
      conv("正文", "para", "p"),
      conv("标题 1", "h1", "h1", oneLine), conv("标题 2", "h2", "h2", oneLine), conv("标题 3", "h3", "h3", oneLine),
      conv("引用", "quote", "quote"),
      conv("无序列表", "ul", "ul"),
      { sep: true } as HandleMenuItem,
    ] : []),
    { label: "在下方复制一份", icon: "dup", run: () => view.dispatch({ changes: { from: unit.to, insert: "\n\n" + text }, selection: { anchor: unit.to + 2 }, userEvent: "input.duplicate" }) },
    { label: "复制内容", icon: "copy", run: () => { navigator.clipboard?.writeText(text).then(() => notify("已复制", "success"), () => notify("没能写进剪贴板", "error")); } },
    { label: b.level ? "整节上移" : "上移", icon: "upArrow", disabled: up === null, run: () => { if (up !== null) moveUnitTo(view, i, up); } },
    { label: b.level ? "整节下移" : "下移", icon: "down", disabled: down === null, run: () => { if (down !== null) moveUnitTo(view, i, down); } },
    { label: "显示源代码", icon: "source", run: () => { view.focus(); view.dispatch({ selection: { anchor: Math.min(b.from + (b.type === "h" ? b.level + 1 : 2), b.to) }, scrollIntoView: true }); } },
    { sep: true },
    { label: "删除", icon: "trash", danger: true, run: () => removeBlock(view, b) },
  ];
}

/* ---------------- 把手提供者 ---------------- */

const provider: HandleProvider = {
  at(view, pos) {
    if (isReading(view.state)) return null;
    const i = blockIndexAt(view.state, pos);
    if (i < 0) return null;
    const b = docBlocks(view.state)[i];
    if (b.type === "list") return null; // 列表有自己的把手（lists.ts）
    const t: HandleTarget = {
      key: b.from,
      anchor: b.from,
      gap: 22,
      outer: true,
      label: TYPE_NAME[b.type],
      menu: () => { const k = blockIndexAt(view.state, b.from, true); return k >= 0 ? menuFor(view, k) : []; },
      drag: {
        slots() {
          const st = view.state;
          const bs = docBlocks(st, true);
          const k = bs.findIndex((x) => x.from === b.from);
          const unit = k >= 0 ? unitOf(bs, k) : b;
          const out: { before: number; y: number }[] = [];
          for (const x of bs) {
            if (x.from > unit.from && x.from <= unit.to) continue;
            const r = view.coordsAtPos(x.from, 1);
            if (r) out.push({ before: x.from, y: Math.round(r.top - 4) });
          }
          const last = bs[bs.length - 1];
          const r = last && view.coordsAtPos(last.to, -1);
          if (r) out.push({ before: st.doc.length, y: Math.round(r.bottom + 4) });
          return out;
        },
        place() { return { x: view.contentDOM.getBoundingClientRect().left, depth: 0 }; },
        drop(slot) {
          const k = blockIndexAt(view.state, b.from, true);
          if (k >= 0) moveUnitTo(view, k, slot.before);
        },
      },
    };
    return t;
  },
};

export function blockMoves(): Extension {
  return blockHandle([provider]);
}
