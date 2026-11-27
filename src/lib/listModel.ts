/**
 * 列表的结构模型（纯函数，不依赖编辑器）：一段连续的列表行 → 每一项的层级、父子、显示编号、待办状态；
 * 以及图形化编辑要用的操作：上移 / 下移、缩进、改类型、删除、勾选（父项状态由叶子决定）。
 * 操作都返回新的行数组，由调用方替换整个列表块。
 */

/** 列表项行首：缩进、符号、可选的勾选框、符号后的空白 */
export const ITEM_RE = /^([ \t]*)([-*+]|\d{1,9}[.)])(?:([ \t]+)\[([ xX])\](?=[ \t]|$))?([ \t]+|$)/;
const width = (ws: string) => ws.replace(/\t/g, "    ").length;

export interface LItem {
  /** 在块里的第几行 */
  line: number;
  /** 行首缩进（按空格数，Tab 算 4） */
  indent: number;
  depth: number;
  /** 符号原文：- * + 或 3. 3) */
  marker: string;
  ordered: boolean;
  /** 源码里写的编号（无序为 0） */
  num: number;
  /** 显示的编号：同一级连续的有序项按「第一项的编号 + 序号」 */
  shown: number;
  /** 勾选框：" " 没勾、"x" 勾了，null 不是待办 */
  task: " " | "x" | null;
  /** 行首到正文开始的字符数（缩进 + 符号 + 勾选框 + 空白） */
  prefix: number;
  parent: number;
  children: number[];
  /** 这一项连同子项、续行占到第几行（含） */
  end: number;
}

export interface ListLine { item: number; cont: boolean; ws: number }

export interface ListModel {
  items: LItem[];
  /** 每一行属于哪一项（续行、空行属于上面那一项；列表前面的非列表行 item 为 -1） */
  lines: ListLine[];
}

export function parseList(lines: string[]): ListModel {
  const items: LItem[] = [];
  const out: ListLine[] = [];
  const stack: number[] = []; // 项的下标
  for (let i = 0; i < lines.length; i++) {
    const t = lines[i];
    const m = t.match(ITEM_RE);
    if (m) {
      const indent = width(m[1]);
      while (stack.length && items[stack[stack.length - 1]].indent >= indent) stack.pop();
      const parent = stack.length ? stack[stack.length - 1] : -1;
      const ordered = /\d/.test(m[2]);
      const it: LItem = {
        line: i, indent, depth: stack.length, marker: m[2], ordered, num: ordered ? parseInt(m[2], 10) : 0, shown: 0,
        task: m[4] === undefined ? null : m[4] === " " ? " " : "x", prefix: m[0].length, parent, children: [], end: i,
      };
      const idx = items.push(it) - 1;
      if (parent >= 0) items[parent].children.push(idx);
      stack.push(idx);
      out.push({ item: idx, cont: false, ws: m[1].length });
    } else {
      const owner = stack.length ? stack[stack.length - 1] : -1;
      out.push({ item: owner, cont: owner >= 0 && t.trim() !== "", ws: t.match(/^[ \t]*/)![0].length });
    }
  }
  // 每一项占到哪一行：下一个同级或更浅的项之前（去掉末尾的空行）
  for (let k = 0; k < items.length; k++) {
    let e = lines.length - 1;
    for (let j = k + 1; j < items.length; j++) if (items[j].depth <= items[k].depth) { e = items[j].line - 1; break; }
    while (e > items[k].line && !lines[e].trim()) e--;
    items[k].end = e;
  }
  // 显示编号
  const siblings = (p: number) => (p >= 0 ? items[p].children : items.map((x, i) => (x.parent === -1 ? i : -1)).filter((i) => i >= 0));
  const groups = new Set<number>([-1, ...items.map((_, i) => i)]);
  for (const p of groups) {
    let prev: LItem | null = null;
    for (const i of siblings(p)) {
      const it = items[i];
      if (it.ordered) it.shown = prev && prev.ordered ? prev.shown + 1 : it.num;
      prev = it;
    }
  }
  return { items, lines: out };
}

/* ---------------- 待办 ---------------- */

/** i 下面所有的待办项（不含自己） */
export function descTasks(m: ListModel, i: number): number[] {
  const out: number[] = [];
  const walk = (k: number) => { for (const c of m.items[k].children) { if (m.items[c].task) out.push(c); walk(c); } };
  walk(i);
  return out;
}

/** 叶子：自己是待办、下面没有待办 */
export const isLeaf = (m: ListModel, i: number) => !!m.items[i].task && descTasks(m, i).length === 0;

export type TaskView = "todo" | "done" | "partial" | "mixed";
export interface TaskInfo { state: TaskView; done: number; total: number }

/**
 * 待办的显示状态。父项（下面有待办）的状态只由叶子决定：叶子全勾 → done；
 * 源码里父项勾了、叶子没全勾（比如外部程序改的）→ mixed，显示成半选，不显示成已完成。
 */
export function taskInfo(m: ListModel, i: number): TaskInfo | null {
  const it = m.items[i];
  if (!it.task) return null;
  const leaves = descTasks(m, i).filter((k) => isLeaf(m, k));
  if (!leaves.length) return { state: it.task === "x" ? "done" : "todo", done: 0, total: 0 };
  const done = leaves.filter((k) => m.items[k].task === "x").length;
  const state: TaskView = done === leaves.length ? "done" : it.task === "x" ? "mixed" : done ? "partial" : "todo";
  return { state, done, total: leaves.length };
}

const setBox = (line: string, v: " " | "x") => line.replace(ITEM_RE, (all, ind, mk, sp, box, after) => (box === undefined ? all : `${ind}${mk}${sp}[${v}]${after}`));

/** 父项的勾选框跟着叶子走（从下往上算） */
function syncParents(lines: string[]): string[] {
  let m = parseList(lines);
  const out = lines.slice();
  for (let i = m.items.length - 1; i >= 0; i--) {
    const it = m.items[i];
    if (!it.task || isLeaf(m, i)) continue;
    const info = taskInfo(m, i)!;
    if (!info.total) continue;
    const want = info.done === info.total ? "x" : " ";
    if (it.task !== want) { out[it.line] = setBox(out[it.line], want); m = parseList(out); }
  }
  return out;
}

/**
 * 点勾选框。叶子：切换自己。父项：等于勾上（或在全部完成时取消）下面所有的项。
 * 之后所有父项按叶子重新算。返回新的行和改动了几项。
 */
export function toggleTask(lines: string[], i: number): { lines: string[]; changed: number; on: boolean } {
  const m = parseList(lines);
  const it = m.items[i];
  if (!it?.task) return { lines, changed: 0, on: false };
  const out = lines.slice();
  let on: boolean;
  const kids = descTasks(m, i);
  if (!kids.length) { on = it.task !== "x"; out[it.line] = setBox(out[it.line], on ? "x" : " "); }
  else {
    on = taskInfo(m, i)!.state !== "done";
    for (const k of [i, ...kids]) out[m.items[k].line] = setBox(out[m.items[k].line], on ? "x" : " ");
  }
  const synced = syncParents(out);
  const changed = synced.filter((l, k) => l !== lines[k]).length;
  return { lines: synced, changed, on };
}

/* ---------------- 结构操作 ---------------- */

/** 子项的缩进对齐父项文字的起点（- 是 2 格，1. 是 3 格），Markdown 和 Pandoc 都认得出层级 */
const childIndent = (it: LItem) => it.indent + it.marker.length + 1;

/** 把一段行整体左右挪 delta 格（负数是往左，空白不够时有多少删多少） */
function shift(lines: string[], delta: number): string[] {
  return lines.map((l) => {
    if (!l.trim()) return l;
    if (delta >= 0) return " ".repeat(delta) + l;
    const ws = l.match(/^[ \t]*/)![0];
    const keep = Math.max(0, width(ws) + delta);
    return " ".repeat(keep) + l.slice(ws.length);
  });
}

const sub = (lines: string[], it: LItem) => lines.slice(it.line, it.end + 1);

/** 同级的前一项 / 后一项 */
function sibling(m: ListModel, i: number, dir: -1 | 1): number {
  const it = m.items[i];
  const sibs = it.parent >= 0 ? m.items[it.parent].children : m.items.map((x, k) => (x.parent === -1 ? k : -1)).filter((k) => k >= 0);
  const at = sibs.indexOf(i);
  return sibs[at + dir] ?? -1;
}

/** 把有序项的编号写成显示的编号（结构变了以后源码也规整一遍） */
export function renumber(lines: string[]): string[] {
  const m = parseList(lines);
  const out = lines.slice();
  for (const it of m.items) {
    if (!it.ordered || it.num === it.shown) continue;
    const delim = it.marker.slice(-1);
    out[it.line] = out[it.line].replace(/^([ \t]*)\d+[.)]/, `$1${it.shown}${delim}`);
  }
  return out;
}

/** 上移 / 下移：和同级的前一项 / 后一项（连同各自的子项）交换 */
export function moveItem(lines: string[], i: number, dir: -1 | 1): string[] | null {
  const m = parseList(lines);
  const j = sibling(m, i, dir);
  if (j < 0) return null;
  const [a, b] = dir === -1 ? [m.items[j], m.items[i]] : [m.items[i], m.items[j]];
  const out = [...lines.slice(0, a.line), ...sub(lines, b), ...between(lines, a, b), ...sub(lines, a), ...lines.slice(b.end + 1)];
  return renumber(out);
}
/** a 的子树结束到 b 开始之间的行（通常是空行） */
const between = (lines: string[], a: LItem, b: LItem) => lines.slice(a.end + 1, b.line);

/** 缩进（成为同级前一项的子项）或取消缩进（回到父项那一级），子项一起走 */
export function indentItem(lines: string[], i: number, dir: 1 | -1): string[] | null {
  const m = parseList(lines);
  const it = m.items[i];
  let target: number;
  if (dir === 1) {
    const prev = sibling(m, i, -1);
    if (prev < 0) return null;
    target = childIndent(m.items[prev]);
  } else {
    if (it.parent < 0) return null;
    target = m.items[it.parent].indent;
  }
  const out = lines.slice();
  out.splice(it.line, it.end - it.line + 1, ...shift(sub(lines, it), target - it.indent));
  // 缩进后成了新一级的第一项：有序列表从 1 编号
  if (dir === 1 && it.ordered) {
    const after = parseList(out).items[i];
    if (after && sibling(parseList(out), i, -1) < 0) out[it.line] = out[it.line].replace(/^([ \t]*)\d+([.)])/, "$11$2");
  }
  return renumber(out);
}

export type ListKind = "bullet" | "ordered" | "task";

/** 改类型：这一项和同一级连续的兄弟项一起改（同一级混用 - 和 1. 会被拆成两个列表） */
export function setKind(lines: string[], i: number, kind: ListKind): string[] {
  const m = parseList(lines);
  const it = m.items[i];
  const sibs = it.parent >= 0 ? m.items[it.parent].children : m.items.map((x, k) => (x.parent === -1 ? k : -1)).filter((k) => k >= 0);
  const out = lines.slice();
  let n = 1;
  for (const k of sibs) {
    const s = m.items[k];
    const rest = out[s.line].slice(s.prefix);
    const ind = out[s.line].match(/^[ \t]*/)![0];
    const mk = kind === "ordered" ? `${n++}.` : s.ordered ? "-" : s.marker;
    const box = kind === "task" ? `[${s.task ?? " "}] ` : "";
    out[s.line] = `${ind}${mk} ${box}${rest}`;
    // 符号宽度变了，子项和续行跟着挪，层级才不会乱
    const delta = mk.length - s.marker.length;
    if (delta) out.splice(s.line + 1, s.end - s.line, ...shift(out.slice(s.line + 1, s.end + 1), delta));
  }
  return renumber(out);
}

/** 删除这一项（连同子项） */
export function deleteItem(lines: string[], i: number): string[] {
  const m = parseList(lines);
  const it = m.items[i];
  const out = lines.slice();
  // 删的是一串有序项的第一项：下一项接过它的编号（不然起始号会变）
  const next = sibling(m, i, 1);
  if (it.ordered && next >= 0 && m.items[next].ordered && it.shown === it.num) {
    out[m.items[next].line] = out[m.items[next].line].replace(/^([ \t]*)\d+/, `$1${it.num}`);
  }
  out.splice(it.line, it.end - it.line + 1);
  // 删掉的是最后一项：它前面留下的空行也去掉
  while (it.line === out.length && out.length && !out[out.length - 1].trim()) out.pop();
  return renumber(out);
}

/**
 * 拖动：把第 i 项（连同子项）挪到第 before 行之前（before = 行数表示放到最后），放在 depth 层。
 * depth 不能比放置位置前一项的层级再深一层以上；没有前一项时只能是 0。
 */
export function moveItemTo(lines: string[], i: number, before: number, depth: number): string[] | null {
  const m = parseList(lines);
  const it = m.items[i];
  if (before > it.line && before <= it.end + 1) {
    // 放回原处（只改层级）
    if (depth === it.depth) return null;
  }
  const block = sub(lines, it);
  const rest = [...lines.slice(0, it.line), ...lines.slice(it.end + 1)];
  let at = before > it.end ? before - block.length : before;
  // 放置位置前一项（在去掉被拖的项以后）
  const rm = parseList(rest);
  let prev = -1;
  for (let k = 0; k < rm.items.length; k++) if (rm.items[k].line < at) prev = k;
  // 不能插进前一项的子树中间：落到它子树的末尾
  if (prev >= 0) { const top = topAt(rm, prev, depth); if (top >= 0 && rm.items[top].end >= at) at = rm.items[top].end + 1; }
  const maxDepth = prev >= 0 ? rm.items[prev].depth + 1 : 0;
  depth = Math.max(0, Math.min(depth, maxDepth));
  let target = 0;
  if (prev >= 0) {
    if (depth === rm.items[prev].depth + 1) target = childIndent(rm.items[prev]);
    else { let k = prev; while (rm.items[k].depth > depth) k = rm.items[k].parent; target = rm.items[k].indent; }
  }
  const moved = shift(block, target - it.indent);
  const out = [...rest.slice(0, at), ...moved, ...rest.slice(at)];
  return renumber(out);
}

/** 前一项 prev 在 depth 这一层（或更浅）上的祖先：放在 depth 层时要排在它整个子树后面 */
function topAt(m: ListModel, prev: number, depth: number): number {
  let k = prev;
  while (k >= 0 && m.items[k].depth > depth) k = m.items[k].parent;
  return k;
}
