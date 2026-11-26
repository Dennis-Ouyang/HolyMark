/**
 * 列表的图形化编辑（C 节）：光标进入列表时仍保持渲染（圆点、编号、勾选框都不变），只在文字里编辑；
 * 行首的缩进和符号整体跳过；每一项左侧悬停出现把手（拖动调顺序和层级、点开小菜单）；
 * 待办的父项状态由叶子决定；父项可以折叠子项；需要时切到「显示源代码」。
 * 列表的结构和操作在 lib/listModel.ts（纯函数），这里只管装饰和交互。
 */
import { EditorSelection, EditorState, StateEffect, StateField, Text, type Extension, type Range } from "@codemirror/state";
import { Decoration, EditorView, ViewPlugin, WidgetType, type DecorationSet, type ViewUpdate } from "@codemirror/view";
import { syntaxTree } from "@codemirror/language";
import { undo } from "@codemirror/commands";
import type { SyntaxNode } from "@lezer/common";
import { deleteItem, indentItem, ITEM_RE, LItem, ListKind, ListModel, moveItem, moveItemTo, parseList, setKind, taskInfo, toggleTask } from "../lib/listModel";
import { blockHandle, type HandleProvider, type HandleTarget } from "./blockHandle";
import { notify } from "./notice";

/* ---------------- 状态：哪些列表显示源代码、哪些项折叠了 ---------------- */

/** 列表显示源代码（值是列表块开头的位置）。光标离开这个列表后自动回到渲染 */
export const showListSource = StateEffect.define<number>();
export const listSource = StateField.define<number[]>({
  create: () => [],
  update(v, tr) {
    let out = tr.docChanged ? v.map((p) => tr.changes.mapPos(p, 1)) : v;
    for (const e of tr.effects) if (e.is(showListSource)) out = [...out, e.value];
    if (!out.length || (!tr.selection && !tr.docChanged)) return out;
    const head = tr.state.selection.main.head;
    return out.filter((p) => { const b = listBlockAt(tr.state, p); return !!b && head >= b.from && head <= b.to; });
  },
});

/** 折叠的项（值是这一项所在行的行首） */
export const toggleFold = StateEffect.define<number>();
export const listFolds = StateField.define<number[]>({
  create: () => [],
  update(v, tr) {
    let out = tr.docChanged ? v.map((p) => tr.changes.mapPos(p, -1)) : v;
    for (const e of tr.effects) if (e.is(toggleFold)) out = out.includes(e.value) ? out.filter((p) => p !== e.value) : [...out, e.value];
    return out;
  },
});

/** pos 所在的最外层列表（顶层的 BulletList / OrderedList） */
export function listBlockAt(state: EditorState, pos: number): { from: number; to: number } | null {
  let top: SyntaxNode | null = null;
  for (let n: SyntaxNode | null = syntaxTree(state).resolveInner(pos, 1); n; n = n.parent) {
    if (n.name === "BulletList" || n.name === "OrderedList") top = n;
    if (n.name === "FencedCode" || n.name === "Blockquote") break;
  }
  if (!top) return null;
  return { from: state.doc.lineAt(top.from).from, to: state.doc.lineAt(top.to).to };
}

function blockLines(doc: Text, from: number, to: number) {
  const a = doc.lineAt(from).number, z = doc.lineAt(to).number;
  const lines: string[] = [];
  for (let n = a; n <= z; n++) lines.push(doc.line(n).text);
  return { a, lines };
}

/** 列表在不在渲染状态（「始终显示语法」或者切到源代码时不在） */
export const listRendered = (state: EditorState, blockFrom: number, always: boolean) => !always && !state.field(listSource, false)?.includes(blockFrom);

/** 把列表块的行换成 next：只改动了的行 */
function applyLines(view: EditorView, a: number, prev: string[], next: string[], select?: number) {
  const doc = view.state.doc;
  const from = doc.line(a).from, to = doc.line(a + prev.length - 1).to;
  const insert = next.join("\n");
  if (insert === prev.join("\n")) return false;
  view.dispatch({ changes: { from, to, insert }, selection: select === undefined ? undefined : EditorSelection.cursor(Math.min(select, view.state.doc.length + insert.length - (to - from))), userEvent: "input.list" });
  return true;
}

/* ---------------- 渲染 ---------------- */

const BULLETS = ["•", "◦", "▪"];

interface MarkSpec { kind: "bullet" | "num" | "task" | "none"; depth: number; shown: number; delim: string; state?: string; done?: number; total?: number; fold?: "open" | "closed" | null }

class ListMarkWidget extends WidgetType {
  constructor(readonly s: MarkSpec) { super(); }
  eq(o: ListMarkWidget) { return JSON.stringify(o.s) === JSON.stringify(this.s); }
  toDOM(view: EditorView) {
    const s = this.s;
    const el = document.createElement("span");
    el.className = "hm-lm " + s.kind;
    if (s.kind === "bullet") el.textContent = BULLETS[s.depth % 3];
    else if (s.kind === "num") el.textContent = `${s.shown}${s.delim}`;
    else if (s.kind === "task") {
      const box = document.createElement("span");
      box.className = "hm-check " + (s.state ?? "todo");
      box.setAttribute("role", "checkbox");
      box.setAttribute("aria-checked", s.state === "done" ? "true" : s.state === "mixed" || s.state === "partial" ? "mixed" : "false");
      if (s.state === "done") box.innerHTML = '<svg width="11" height="11" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="m3.5 8.5 3 3 6-7"/></svg>';
      else if (s.state === "mixed") box.innerHTML = '<svg width="10" height="10" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><path d="M4 8h8"/></svg>';
      else if (s.total) {
        // 父项：进度环，按叶子完成的比例
        const c = 2 * Math.PI * 6;
        box.innerHTML = `<svg width="16" height="16" viewBox="0 0 16 16"><circle cx="8" cy="8" r="6" fill="none" stroke="currentColor" stroke-width="2.2" stroke-dasharray="${((s.done! / s.total) * c).toFixed(2)} ${c.toFixed(2)}" transform="rotate(-90 8 8)"/></svg>`;
      }
      box.addEventListener("mousedown", (e) => { e.preventDefault(); e.stopPropagation(); clickTask(view, el); });
      el.append(box);
    }
    if (s.fold) {
      const f = document.createElement("span");
      f.className = "hm-fold " + s.fold;
      f.title = s.fold === "closed" ? "展开" : "折叠子项";
      f.innerHTML = '<svg width="10" height="10" viewBox="0 0 16 16" fill="currentColor"><path d="M5 3.5 11 8l-6 4.5z"/></svg>';
      f.addEventListener("mousedown", (e) => { e.preventDefault(); e.stopPropagation(); view.dispatch({ effects: toggleFold.of(view.state.doc.lineAt(view.posAtDOM(el)).from) }); });
      el.append(f);
    }
    return el;
  }
  ignoreEvent() { return true; }
}

class CountWidget extends WidgetType {
  constructor(readonly done: number, readonly total: number) { super(); }
  eq(o: CountWidget) { return o.done === this.done && o.total === this.total; }
  toDOM() {
    const el = document.createElement("span");
    el.className = "hm-task-count" + (this.done === this.total ? " all" : "");
    el.textContent = `${this.done}/${this.total}`;
    return el;
  }
}

/** 点勾选框：叶子切换自己；父项等于勾上 / 取消下面所有的项（提示条带「撤销」）；父项状态由叶子决定 */
function clickTask(view: EditorView, el: HTMLElement) {
  const pos = view.posAtDOM(el);
  const b = listBlockAt(view.state, pos);
  if (!b) return;
  const { a, lines } = blockLines(view.state.doc, b.from, b.to);
  const line = view.state.doc.lineAt(pos).number - a;
  const m = parseList(lines);
  const i = m.items.findIndex((x) => x.line === line);
  if (i < 0) return;
  const r = toggleTask(lines, i);
  if (!applyLines(view, a, lines, r.lines)) return;
  const kids = m.items[i].task && r.changed > 1 && m.items[i].children.length > 0;
  if (kids) notify(r.on ? `已勾上 ${r.changed} 项` : `已取消 ${r.changed} 项`, "success", { label: "撤销", run: () => { undo(view); view.focus(); } });
}

export interface ListRenderInfo {
  /** 光标所在的行（块内第几行） */
  cursorLines: Set<number>;
  /** 折叠的项所在行（块内第几行） */
  folded: Set<number>;
}

/**
 * 渲染状态下一个列表块的装饰。inline(from, to, active, out) 由 livePreview 提供，处理行内格式。
 * 不在这里处理的：光标所在行的行内格式显示源码（由 inline 的 active 决定）。
 */
export function renderList(state: EditorState, from: number, to: number, info: ListRenderInfo, decos: Range<Decoration>[], inline: (from: number, to: number, active: boolean) => void) {
  const doc = state.doc;
  const { a, lines } = blockLines(doc, from, to);
  const m = parseList(lines);
  const prevLine = a > 1 ? doc.line(a - 1).text : "";
  /** 被折叠起来的行 */
  const hidden = new Set<number>();
  for (const it of m.items) if (info.folded.has(it.line) && it.end > it.line) for (let k = it.line + 1; k <= it.end; k++) hidden.add(k);
  let firstItem = true;
  for (let k = 0; k < lines.length; k++) {
    if (hidden.has(k)) continue;
    const L = doc.line(a + k);
    const ll = m.lines[k];
    if (ll.item < 0) continue;
    const it = m.items[ll.item];
    if (ll.cont) {
      // 同一项里换行接着写的文字：和这一项的文字对齐
      decos.push(Decoration.line({ class: "hm-li hm-cont", attributes: { style: `--d:${it.depth}` } }).range(L.from));
      if (ll.ws) decos.push(hide.range(L.from, L.from + Math.min(ll.ws, L.length)));
      inline(L.from + ll.ws, L.to, info.cursorLines.has(k));
      continue;
    }
    if (it.line !== k) continue; // 空行
    const t = taskInfo(m, ll.item);
    const hasKids = it.end > it.line && m.items.some((x) => x.parent === ll.item);
    const folded = info.folded.has(k) && hasKids;
    const spec: MarkSpec = {
      kind: it.task ? "task" : it.ordered ? "num" : "bullet", depth: it.depth, shown: it.shown, delim: it.marker.slice(-1),
      state: t?.state, done: t?.done, total: t?.total, fold: hasKids ? (folded ? "closed" : "open") : null,
    };
    let cls = "hm-li";
    if (firstItem && prevLine.trim()) cls += " hm-li-after"; // 紧跟段落：上面留段距
    if (!firstItem) cls += " hm-li-next";
    if (folded) cls += " hm-li-folded";
    if (t?.total) cls += " hm-li-parent";
    firstItem = false;
    decos.push(Decoration.line({ class: cls, attributes: { style: `--d:${it.depth}` } }).range(L.from));
    const pre = Math.min(it.prefix, L.length);
    decos.push(Decoration.replace({ widget: new ListMarkWidget(spec) }).range(L.from, L.from + pre));
    // 已完成：灰色加删除线，只划文字本身（不划行尾空格）
    const body = L.text.slice(pre).replace(/\s+$/, "");
    if (t?.state === "done" && body) decos.push(Decoration.mark({ class: "hm-done" }).range(L.from + pre, L.from + pre + body.length));
    inline(L.from + pre, L.to, info.cursorLines.has(k));
    if (t?.total) decos.push(Decoration.widget({ widget: new CountWidget(t.done, t.total), side: folded ? -1 : 1 }).range(L.to));
    if (folded) decos.push(Decoration.replace({}).range(L.to, doc.line(a + it.end).to));
  }
}

const hide = Decoration.replace({});

/* ---------------- 光标：行首的符号整体跳过 ---------------- */

/** 可见范围里，渲染状态的列表行首（缩进 + 符号 + 勾选框）和折叠起来的行 */
function atomsOf(view: EditorView, always: boolean): DecorationSet {
  const ranges: Range<Decoration>[] = [];
  const st = view.state, doc = st.doc;
  const seen = new Set<number>();
  const folds = st.field(listFolds, false) ?? [];
  for (const { from, to } of view.visibleRanges) {
    for (let pos = from; pos <= to; ) {
      const L = doc.lineAt(pos);
      pos = L.to + 1;
      const b = (L.text.trim() && listBlockAt(st, L.from + (L.text.length - L.text.trimStart().length))) || null;
      if (!b || seen.has(L.from) || !listRendered(st, b.from, always)) continue;
      seen.add(L.from);
      const m = L.text.match(ITEM_RE);
      const n = m ? m[0].length : L.text.length - L.text.trimStart().length;
      if (n > 0) ranges.push(mark.range(L.from, L.from + Math.min(n, L.length)));
      if (m && folds.includes(L.from)) {
        const { a, lines } = blockLines(doc, b.from, b.to);
        const it = parseList(lines).items.find((x) => x.line === L.number - a);
        if (it && it.end > it.line) ranges.push(mark.range(L.to, doc.line(a + it.end).to));
      }
    }
  }
  return Decoration.set(ranges, true);
}
const mark = Decoration.mark({});

function atoms(always: () => boolean) {
  return ViewPlugin.fromClass(class {
    set: DecorationSet;
    constructor(v: EditorView) { this.set = atomsOf(v, always()); }
    update(u: ViewUpdate) {
      if (u.docChanged || u.viewportChanged || u.transactions.some((t) => t.effects.some((e) => e.is(toggleFold) || e.is(showListSource)))) this.set = atomsOf(u.view, always());
    }
  }, { provide: (p) => EditorView.atomicRanges.of((v) => v.plugin(p)?.set ?? Decoration.none) });
}

/** 光标落在列表行的最前面（符号之前）时，挪到正文开头：免得在符号前面打字 */
function caretFilter(always: () => boolean) {
  return EditorState.transactionFilter.of((tr) => {
    if (!tr.selection || always()) return tr;
    const sel = tr.selection.main;
    if (!sel.empty) return tr;
    const st = tr.state;
    const L = st.doc.lineAt(sel.head);
    if (sel.head !== L.from) return tr;
    const m = L.text.match(ITEM_RE);
    const n = m ? m[0].length : L.text.trim() ? L.text.length - L.text.trimStart().length : 0;
    if (!n) return tr;
    const b = listBlockAt(st, L.from + (L.text.length - L.text.trimStart().length));
    if (!b || !listRendered(st, b.from, false)) return tr;
    return [tr, { selection: EditorSelection.cursor(L.from + Math.min(n, L.length)), sequential: true }];
  });
}

/* ---------------- 把手 ---------------- */

interface Ctx { a: number; lines: string[]; m: ListModel; i: number; it: LItem; block: { from: number; to: number } }

function ctxAt(state: EditorState, pos: number): Ctx | null {
  // 从这一行第一个非空白字符找：行尾的位置在语法树里可能已经在列表外面
  const L = state.doc.lineAt(pos);
  const block = listBlockAt(state, L.from + (L.text.length - L.text.trimStart().length));
  if (!block) return null;
  const { a, lines } = blockLines(state.doc, block.from, block.to);
  const m = parseList(lines);
  const line = state.doc.lineAt(pos).number - a;
  // 续行、空行属于它上面的那一项
  const i = m.lines[line]?.item ?? -1;
  if (i < 0) return null;
  return { a, lines, m, i, it: m.items[i], block };
}

const STEP_EM = 1.75; // 和 CSS 里 --slot 一致

function listProvider(always: () => boolean): HandleProvider {
  return {
    at(view, pos) {
      if (always()) return null;
      const c = ctxAt(view.state, pos);
      if (!c || !listRendered(view.state, c.block.from, false)) return null;
      const doc = view.state.doc;
      const lineFrom = doc.line(c.a + c.it.line).from;
      const run = (next: string[] | null, focusLine?: number) => {
        if (!next) return;
        const cur = ctxAt(view.state, lineFrom);
        if (!cur) return;
        applyLines(view, cur.a, cur.lines, next, focusLine === undefined ? undefined : view.state.doc.line(cur.a).from + next.slice(0, focusLine).reduce((s, l) => s + l.length + 1, 0) + (next[focusLine]?.match(ITEM_RE)?.[0].length ?? 0));
      };
      const kind = (k: ListKind) => () => run(setKind(c.lines, c.i, k));
      const curKind: ListKind = c.it.task ? "task" : c.it.ordered ? "ordered" : "bullet";
      const t: HandleTarget = {
        key: lineFrom,
        // 把手放在符号的左边，再留出折叠小三角的位置
        anchor: lineFrom,
        gap: 18,
        label: "列表项",
        menu: () => [
          { label: "无序列表", icon: "ul", disabled: curKind === "bullet", run: kind("bullet") },
          { label: "有序列表", icon: "ol", disabled: curKind === "ordered", run: kind("ordered") },
          { label: "待办列表", icon: "task", disabled: curKind === "task", run: kind("task") },
          { sep: true },
          { label: "增加缩进", icon: "indent", hint: "Tab", run: () => run(indentItem(c.lines, c.i, 1)) },
          { label: "减少缩进", icon: "outdent", hint: "⇧Tab", run: () => run(indentItem(c.lines, c.i, -1)) },
          { label: "上移", icon: "upArrow", run: () => run(moveItem(c.lines, c.i, -1)) },
          { label: "下移", icon: "down", run: () => run(moveItem(c.lines, c.i, 1)) },
          { sep: true },
          { label: "显示源代码", icon: "source", run: () => view.dispatch({ effects: showListSource.of(c.block.from), selection: EditorSelection.cursor(lineFrom + c.it.prefix) }) },
          { sep: true },
          {
            label: "删除这一项", icon: "trash", danger: true, run: () => {
              run(deleteItem(c.lines, c.i));
              notify("已删除这一项", "success", { label: "撤销", run: () => { undo(view); view.focus(); } });
            },
          },
        ],
        drag: {
          slots() {
            const out: { before: number; y: number }[] = [];
            const docNow = view.state.doc;
            for (const x of c.m.items) {
              if (x.line >= c.it.line && x.line <= c.it.end) continue;
              const r = view.coordsAtPos(docNow.line(c.a + x.line).from, 1);
              if (r) out.push({ before: x.line, y: r.top });
            }
            const last = view.coordsAtPos(docNow.line(c.a + c.lines.length - 1).to, -1);
            if (last) out.push({ before: c.lines.length, y: last.bottom });
            return out;
          },
          place(slot, dx) {
            const step = parseFloat(getComputedStyle(view.contentDOM).fontSize) * STEP_EM;
            const prev = [...c.m.items].reverse().find((x) => x.line < slot.before && !(x.line >= c.it.line && x.line <= c.it.end));
            const max = prev ? prev.depth + 1 : 0;
            const depth = Math.max(0, Math.min(max, c.it.depth + Math.round(dx / step)));
            const left = view.contentDOM.getBoundingClientRect().left;
            return { x: left + depth * step, depth };
          },
          drop(slot, depth) {
            const cur = ctxAt(view.state, lineFrom);
            if (!cur) return;
            run(moveItemTo(cur.lines, cur.i, slot.before, depth));
          },
        },
      };
      return t;
    },
  };
}

export function lists(always: () => boolean): Extension {
  return [listSource, listFolds, atoms(always), caretFilter(always), blockHandle([listProvider(always)])];
}
