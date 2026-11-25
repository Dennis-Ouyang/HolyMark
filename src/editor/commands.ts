/** 格式命令：都只是在源码里加减 Markdown 符号。工具栏、功能区、快捷键共用。 */
import { EditorSelection, EditorState } from "@codemirror/state";
import type { EditorView } from "@codemirror/view";
import { ensureSyntaxTree, syntaxTree } from "@codemirror/language";
import type { SyntaxNode } from "@lezer/common";

export type InlineKind = "bold" | "italic" | "strike" | "code" | "math";
const MARK: Record<InlineKind, string> = { bold: "**", italic: "*", strike: "~~", code: "`", math: "$" };

/* ---------------- 粗体、斜体、删除线：按“带格式的字”来切换 ---------------- */
// 只看选区两侧紧挨着的符号，遇到嵌套（***~~字~~***）就会判断错、越加越乱。
// 这里先把相关的一段源码解析成一串字，每个字记着自己有哪些格式；切换格式后再按规范的嵌套顺序写回 Markdown。

type Style = "bold" | "italic" | "strike";
const STYLES: Style[] = ["strike", "bold", "italic"]; // 同时开始时由外到内的顺序
const STYLE_NODE: Record<string, Style> = { StrongEmphasis: "bold", Emphasis: "italic", Strikethrough: "strike" };
const STYLE_MARK: Record<Style, string> = { bold: "EmphasisMark", italic: "EmphasisMark", strike: "StrikethroughMark" };
/** 当成一个整体的行内元素：里面的源码原样保留，格式只能加在它整体外面 */
const ATOM_NODE = new Set(["Link", "Image", "InlineCode", "Autolink", "URL", "HTMLTag", "Escape", "Entity"]);
const ATOM_RE = /\{==[\s\S]+?==\}\{>>[\s\S]*?<<\}|\[@[\w:.-]+(?:\s*;\s*@[\w:.-]+)*\]|(?<![\\$])\$[^$\n]+?\$(?!\$)/g;
/** 行首的块标记（标题、引用、列表、缩进），不能被包进格式符号里 */
const LINE_PREFIX = /^(?:[ \t]*(?:>[ \t]?|#{1,6}[ \t]+|[-*+][ \t]+\[[ xX]\][ \t]+|[-*+][ \t]+|\d+[.)][ \t]+))*[ \t]*/;

interface Unit { text: string; from: number; to: number; raw: boolean; styles: Set<Style> }
interface StyleNode { style: Style; from: number; to: number; open: number; close: number }

function treeOf(state: EditorState, to: number) {
  return ensureSyntaxTree(state, Math.min(state.doc.length, to + 1), 200) ?? syntaxTree(state);
}

/** 选区所在的一段：向外扩到覆盖所有和它相交的格式节点、整体元素，然后切成一串字 */
function analyze(state: EditorState, from: number, to: number) {
  const doc = state.doc;
  let r0 = from, r1 = to;
  let nodes: StyleNode[] = [], atoms: [number, number][] = [];
  for (let round = 0; round < 6; round++) {
    const l0 = doc.lineAt(r0).from, l1 = doc.lineAt(r1).to;
    const tree = treeOf(state, l1);
    nodes = []; atoms = [];
    const text = doc.sliceString(l0, l1);
    for (const m of text.matchAll(ATOM_RE)) atoms.push([l0 + m.index!, l0 + m.index! + m[0].length]);
    tree.iterate({
      from: l0, to: l1,
      enter: (n) => {
        if (ATOM_NODE.has(n.name)) { atoms.push([n.from, n.to]); return false; }
        const st = STYLE_NODE[n.name];
        if (!st) return;
        const marks = n.node.getChildren(STYLE_MARK[st]);
        if (marks.length < 2) return; // 没闭合的不算
        const open = marks[0].to - marks[0].from, close = marks[marks.length - 1].to - marks[marks.length - 1].from;
        if (marks[0].from !== n.from || marks[marks.length - 1].to !== n.to) return;
        nodes.push({ style: st, from: n.from, to: n.to, open, close });
      },
    });
    // 整体元素里面的格式节点不拆
    nodes = nodes.filter((nd) => !atoms.some(([a, z]) => nd.from >= a && nd.to <= z && !(nd.from === a && nd.to === z)));
    let a0 = r0, a1 = r1;
    const touches = (f: number, t: number) => (a0 === a1 ? f <= a0 && t >= a1 : f < a1 && t > a0);
    for (const nd of nodes) if (touches(nd.from, nd.to)) { a0 = Math.min(a0, nd.from); a1 = Math.max(a1, nd.to); }
    for (const [f, t] of atoms) if (f < a1 && t > a0) { a0 = Math.min(a0, f); a1 = Math.max(a1, t); }
    if (a0 === r0 && a1 === r1) break;
    r0 = a0; r1 = a1;
  }
  // 起点落在行首标记里时挪到标记后面
  const firstLine = doc.lineAt(r0);
  const pre0 = firstLine.from + (firstLine.text.match(LINE_PREFIX)?.[0].length ?? 0);
  if (r0 < pre0) r0 = Math.min(pre0, r1);

  const markAt = new Map<number, number>(); // 格式符号的起点 → 终点
  for (const nd of nodes) if (nd.from >= r0 && nd.to <= r1) { markAt.set(nd.from, nd.from + nd.open); markAt.set(nd.to - nd.close, nd.to); }
  const inner = nodes.filter((nd) => nd.from >= r0 && nd.to <= r1);
  const stylesAt = (p: number) => new Set(inner.filter((nd) => p >= nd.from + nd.open && p < nd.to - nd.close).map((nd) => nd.style));
  const atomAt = new Map(atoms.map(([f, t]) => [f, t]));
  const units: Unit[] = [];
  for (let p = r0; p < r1; ) {
    const m = markAt.get(p);
    if (m !== undefined && m > p) { p = m; continue; }
    const a = atomAt.get(p);
    if (a !== undefined && a <= r1) { units.push({ text: doc.sliceString(p, a), from: p, to: a, raw: false, styles: stylesAt(p) }); p = a; continue; }
    const ch = doc.sliceString(p, p + 1);
    if (ch === "\n") {
      const next = doc.lineAt(p + 1);
      const end = Math.min(r1, next.from + (next.text.match(LINE_PREFIX)?.[0].length ?? 0));
      units.push({ text: doc.sliceString(p, end), from: p, to: end, raw: true, styles: new Set() });
      p = end; continue;
    }
    // 一个码点（emoji 等占两个 UTF-16 单位）
    const cp = String.fromCodePoint(doc.sliceString(p, p + 2).codePointAt(0)!);
    units.push({ text: cp, from: p, to: p + cp.length, raw: false, styles: stylesAt(p) });
    p += cp.length;
  }
  return { r0, r1, units, nodes: inner };
}

const isSpace = (u: Unit) => !u.raw && /^\s+$/.test(u.text);

/** 按规范的嵌套写回 Markdown；返回每个字在新文本里的起止，以及每个字前面（关掉上一段格式之后）的位置 */
function serialize(units: Unit[]) {
  let out = "";
  const stack: Style[] = [];
  const at: { from: number; to: number }[] = [];
  const gap: number[] = [];
  const closeTo = (k: number) => { for (let j = stack.length - 1; j >= k; j--) out += MARK[stack[j]]; stack.length = Math.max(0, k); };
  const runEnd = (s: Style, i: number) => { let j = i; while (j < units.length && !units[j].raw && units[j].styles.has(s)) j++; return j; };
  units.forEach((u, i) => {
    if (u.raw) { closeTo(0); gap[i] = out.length; at[i] = { from: out.length, to: out.length + u.text.length }; out += u.text; return; }
    const k = stack.findIndex((s) => !u.styles.has(s));
    if (k >= 0) closeTo(k);
    gap[i] = out.length;
    const open = STYLES.filter((s) => u.styles.has(s) && !stack.includes(s)).sort((a, b) => runEnd(b, i) - runEnd(a, i) || STYLES.indexOf(a) - STYLES.indexOf(b));
    for (const s of open) { out += MARK[s]; stack.push(s); }
    at[i] = { from: out.length, to: out.length + u.text.length };
    out += u.text;
  });
  closeTo(0);
  gap[units.length] = out.length;
  return { out, at, gap };
}

/** 选中的字（不含空白）是否都带着这个格式 */
function allHave(units: Unit[], sel: number[], s: Style) {
  const real = sel.filter((i) => !isSpace(units[i]));
  return real.length > 0 && real.every((i) => units[i].styles.has(s));
}

/**
 * 切换粗体 / 斜体 / 删除线。选中的字都已经有这个格式就去掉，否则加上；
 * 其余格式保持不变，符号按 删除线 ⊃ 粗体 ⊃ 斜体 的顺序重新嵌套，不会叠出多余的符号。
 * 返回新的选区：keep 时仍然选中原来那些字（浮动工具栏里连续点用），否则光标放到这段文字末尾。
 */
export function toggleStyle(state: EditorState, from: number, to: number, s: Style, keep: boolean): { changes: { from: number; to: number; insert: string }; anchor: number; head: number } | null {
  const { r0, r1, units, nodes } = analyze(state, from, to);
  if (from === to) {
    // 光标在带这个格式的文字里：整段去掉这个格式；不在的话插入一对符号，光标停在中间
    const hit = nodes.filter((nd) => nd.style === s && from >= nd.from + nd.open && from <= nd.to - nd.close).sort((a, b) => (a.to - a.from) - (b.to - b.from))[0];
    if (!hit) return { changes: { from, to, insert: MARK[s] + MARK[s] }, anchor: from + MARK[s].length, head: from + MARK[s].length };
    const sel = units.map((u, i) => (u.from >= hit.from && u.to <= hit.to ? i : -1)).filter((i) => i >= 0);
    sel.forEach((i) => units[i].styles.delete(s));
    const { out, at } = serialize(units);
    const idx = units.findIndex((u) => u.from >= from);
    const pos = r0 + (idx < 0 ? out.length : at[idx].from);
    return { changes: { from: r0, to: r1, insert: out }, anchor: pos, head: pos };
  }
  const sel = units.map((u, i) => (!u.raw && u.to > from && u.from < to ? i : -1)).filter((i) => i >= 0);
  if (!sel.some((i) => !isSpace(units[i]))) return null;
  const on = !allHave(units, sel, s);
  for (const i of sel) if (on) units[i].styles.add(s); else units[i].styles.delete(s);
  // 格式两端不能是空白（** 字** 不是粗体），把首尾的空白挪到格式外面
  for (const st of STYLES) {
    for (let i = 0; i < units.length; ) {
      if (units[i].raw || !units[i].styles.has(st)) { i++; continue; }
      let j = i; while (j < units.length && !units[j].raw && units[j].styles.has(st)) j++;
      for (let k = i; k < j && isSpace(units[k]); k++) units[k].styles.delete(st);
      for (let k = j - 1; k >= i && isSpace(units[k]); k--) units[k].styles.delete(st);
      i = j;
    }
  }
  const { out, at, gap } = serialize(units);
  const first = sel[0], last = sel[sel.length - 1];
  const change = { from: r0, to: r1, insert: out };
  if (keep) return { changes: change, anchor: r0 + at[first].from, head: r0 + at[last].to };
  const end = r0 + gap[last + 1];
  return { changes: change, anchor: end, head: end };
}

/** 选区（或光标处）当前带着的行内格式，给工具栏显示按下状态 */
export function activeStyles(state: EditorState, from: number, to: number): Set<InlineKind> {
  const out = new Set<InlineKind>();
  if (to - from > 4000) return out; // 选了一大片时不算，免得每次移动光标都卡
  const { units, nodes } = analyze(state, from, to);
  if (from === to) {
    for (const nd of nodes) if (from >= nd.from + nd.open && from <= nd.to - nd.close) out.add(nd.style);
  } else {
    const sel = units.map((u, i) => (!u.raw && u.to > from && u.from < to ? i : -1)).filter((i) => i >= 0);
    for (const s of STYLES) if (allHave(units, sel, s)) out.add(s);
  }
  for (let n: SyntaxNode | null = treeOf(state, to).resolveInner(from, 1); n; n = n.parent) if (n.name === "InlineCode" && n.from <= from && n.to >= to) out.add("code");
  const line = state.doc.lineAt(from);
  if (line.number === state.doc.lineAt(to).number) {
    for (const m of line.text.matchAll(/(?<![\\$])\$[^$\n]+?\$(?!\$)/g)) {
      const a = line.from + m.index!, z = a + m[0].length;
      if (a < from + 1 && z > to - 1 && from >= a && to <= z) out.add("math");
    }
  }
  return out;
}

/**
 * 加上或去掉行内格式。粗体、斜体、删除线用 toggleStyle；行内代码和公式仍按两侧符号判断。
 * keep：保持选中这些字（浮动工具栏）；否则完成后光标放在这段文字末尾，没选中文字时光标停在两个符号中间。
 */
export function toggleInline(view: EditorView, kind: InlineKind, keep = false) {
  if (kind === "bold" || kind === "italic" || kind === "strike") {
    const { state } = view;
    const r = state.selection.main;
    const res = toggleStyle(state, r.from, r.to, kind, keep);
    if (res) view.dispatch({ changes: res.changes, selection: EditorSelection.range(res.anchor, res.head), userEvent: "input.format" });
    view.focus();
    return;
  }
  const mk = MARK[kind];
  const { state } = view;
  view.dispatch(state.changeByRange((r) => {
    if (r.empty) {
      return { changes: { from: r.from, insert: mk + mk }, range: EditorSelection.cursor(r.from + mk.length) };
    }
    const before = state.sliceDoc(r.from - mk.length, r.from);
    const after = state.sliceDoc(r.to, r.to + mk.length);
    if (before === mk && after === mk) {
      return { changes: [{ from: r.from - mk.length, to: r.from }, { from: r.to, to: r.to + mk.length }], range: keep ? EditorSelection.range(r.from - mk.length, r.to - mk.length) : EditorSelection.cursor(r.to - mk.length) };
    }
    const inner = state.sliceDoc(r.from, r.to);
    if (inner.length >= 2 * mk.length && inner.startsWith(mk) && inner.endsWith(mk)) {
      return { changes: { from: r.from, to: r.to, insert: inner.slice(mk.length, -mk.length) }, range: keep ? EditorSelection.range(r.from, r.to - 2 * mk.length) : EditorSelection.cursor(r.to - 2 * mk.length) };
    }
    return { changes: [{ from: r.from, insert: mk }, { from: r.to, insert: mk }], range: keep ? EditorSelection.range(r.from + mk.length, r.to + mk.length) : EditorSelection.cursor(r.to + 2 * mk.length) };
  }));
  view.focus();
}

export function insertLink(view: EditorView, url = "https://") {
  const r = view.state.selection.main;
  const text = view.state.sliceDoc(r.from, r.to) || "链接文字";
  const ins = `[${text}](${url})`;
  const urlFrom = r.from + text.length + 3;
  view.dispatch({ changes: { from: r.from, to: r.to, insert: ins }, selection: EditorSelection.range(urlFrom, urlFrom + url.length) });
  view.focus();
}

/** 给选中文字加批注，光标停在冒号后面直接写批注内容 */
export function insertNote(view: EditorView, author: string) {
  const r = view.state.selection.main;
  if (r.empty) return false;
  const d = new Date();
  const date = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  const quote = view.state.sliceDoc(r.from, r.to);
  const head = `{==${quote}==}{>>@${author} ${date}：`;
  view.dispatch({ changes: { from: r.from, to: r.to, insert: head + "<<}" }, selection: { anchor: r.from + head.length } });
  view.focus();
  return true;
}

export type BlockKind = "p" | "h1" | "h2" | "h3" | "quote" | "ul" | "ol" | "task";
const PREFIX = /^(\s*)(#{1,6} |> ?|[-*+] \[[ xX]\] |[-*+] |\d+\. )?/;

/** 把选中的行改成某种段落类型 */
export function setBlock(view: EditorView, kind: BlockKind) {
  const { state } = view;
  const r = state.selection.main;
  const a = state.doc.lineAt(r.from).number, z = state.doc.lineAt(r.to).number;
  const changes = [];
  for (let n = a, i = 0; n <= z; n++, i++) {
    const line = state.doc.line(n);
    const m = line.text.match(PREFIX)!;
    const pre = { p: "", h1: "# ", h2: "## ", h3: "### ", quote: "> ", ul: "- ", ol: `${i + 1}. `, task: "- [ ] " }[kind];
    changes.push({ from: line.from + m[1].length, to: line.from + m[0].length, insert: pre });
  }
  const set = state.changes(changes);
  // 光标放到最后一行末尾
  view.dispatch({ changes: set, selection: { anchor: set.mapPos(state.doc.line(z).to, 1) } });
  view.focus();
}

export function currentBlock(view: EditorView): BlockKind {
  const t = view.state.doc.lineAt(view.state.selection.main.head).text;
  const m = t.match(/^(#{1,3}) /);
  if (m) return (`h${m[1].length}`) as BlockKind;
  if (/^\s*> ?/.test(t)) return "quote";
  if (/^\s*[-*+] \[[ xX]\] /.test(t)) return "task";
  if (/^\s*[-*+] /.test(t)) return "ul";
  if (/^\s*\d+\. /.test(t)) return "ol";
  return "p";
}

/** 在当前块之后插入一个新块，cursorOffset 指定光标在新块里的位置 */
export function insertBlock(view: EditorView, text: string, cursorOffset?: number) {
  const { state } = view;
  const line = state.doc.lineAt(state.selection.main.head);
  let pos = line.to;
  // 跳到当前段落末尾
  for (let n = line.number + 1; n <= state.doc.lines; n++) {
    const l = state.doc.line(n);
    if (!l.text.trim()) break;
    pos = l.to;
  }
  const lead = line.text.trim() ? "\n\n" : "";
  const insert = lead + text + "\n";
  const at = pos + lead.length + (cursorOffset ?? text.length);
  view.dispatch({ changes: { from: pos, insert }, selection: { anchor: at }, scrollIntoView: true });
  view.focus();
}

export function tableMarkdown(rows: number, cols: number) {
  const row = (cells: string[]) => "| " + cells.join(" | ") + " |";
  const head = row(Array.from({ length: cols }, (_, i) => `列${i + 1}`));
  const sep = row(Array.from({ length: cols }, () => "---"));
  const body = Array.from({ length: rows }, () => row(Array.from({ length: cols }, () => "  ")));
  return [head, sep, ...body].join("\n");
}

/** 在列表里回车时续写编号；空项回车则结束列表 */
export function continueList(view: EditorView): boolean {
  const { state } = view;
  const r = state.selection.main;
  if (!r.empty) return false;
  const line = state.doc.lineAt(r.head);
  const m = line.text.match(/^(\s*)([-*+]|(\d+)\.)( \[[ xX]\])? /);
  if (!m || r.head < line.from + m[0].length) return false;
  if (line.text.trim() === m[0].trim()) {
    view.dispatch({ changes: { from: line.from, to: line.to, insert: "" }, selection: { anchor: line.from } });
    return true;
  }
  const next = m[1] + (m[3] ? `${+m[3] + 1}.` : m[2]) + (m[4] ? " [ ]" : "") + " ";
  view.dispatch({ changes: { from: r.head, insert: "\n" + next }, selection: { anchor: r.head + 1 + next.length }, scrollIntoView: true });
  return true;
}
