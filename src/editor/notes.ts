/**
 * 图形化的批注。文件里仍是标准的 CriticMarkup：{==原文==}{>>@作者 日期：内容<<}，AI 和别的编辑器都读得懂；
 * 但在 HolyMark 里看不到这些符号：
 * - 正文里只有一种安静的信号：原文铺一层很浅的底色（--note-bg），行右侧的页边一个小圆点（同一行多条时显示数字）；
 *   不加下划线，也不在文字中间插图标（以前的行内图标会掉到下一行开头、把「。」顶到行首）；
 * - 光标落进原文（或者点原文、点页边圆点）时浮出批注浮层：名字和日期、内容、「解决」，「删除」在更多菜单里；
 *   浮层始终在正文栏里，放不下就挪或翻到上方；
 * - 自己写的批注点文字就能改；别人写的只读。
 */
import { EditorSelection, EditorState, Extension, RangeSetBuilder, StateEffect, StateField } from "@codemirror/state";
import { Decoration, DecorationSet, EditorView, showTooltip, Tooltip, tooltips, ViewPlugin, ViewUpdate } from "@codemirror/view";
import { ensureSyntaxTree, syntaxTree } from "@codemirror/language";
import type { SyntaxNode } from "@lezer/common";
import { undo } from "@codemirror/commands";
import { iconSvg } from "../lib/icons";
import { HEADING_ATTR } from "../lib/markdown";
import { CARD_EXT } from "../lib/filePreview";
import { openDomMenu } from "./domMenu";
import { notify } from "./notice";

export const NOTE_RE = /\{==([\s\S]+?)==\}\{>>([\s\S]*?)<<\}/g;
export interface NoteHit { from: number; to: number; quoteFrom: number; quoteTo: number; bodyFrom: number; bodyTo: number; quote: string; who: string; date: string; text: string }

/** 批注内容里 @作者 日期：之后的部分 */
export function parseBody(body: string) {
  const m = body.match(/^@(\S+)\s+(\S+?)：([\s\S]*)$/);
  return m ? { who: m[1], date: m[2], text: m[3], prefix: body.length - m[3].length } : { who: "", date: "", text: body, prefix: 0 };
}

/** pos 落在哪条批注的原文里（含两端） */
export function noteAt(state: EditorState, pos: number): NoteHit | null {
  const a = Math.max(0, pos - 4000), z = Math.min(state.doc.length, pos + 4000);
  const text = state.sliceDoc(a, z);
  for (const m of text.matchAll(NOTE_RE)) {
    const from = a + m.index!, to = from + m[0].length;
    const quoteFrom = from + 3, quoteTo = quoteFrom + m[1].length;
    if (pos < quoteFrom || pos > quoteTo) continue;
    const bodyFrom = quoteTo + 6, bodyTo = to - 3; // ==}{>> 是 6 个字符，<<} 是 3 个
    const b = parseBody(m[2]);
    return { from, to, quoteFrom, quoteTo, bodyFrom, bodyTo, quote: m[1], who: b.who, date: b.date, text: b.text };
  }
  return null;
}

/** 批注内容不能带 <<}（会提前结束批注），也不能有空行（会把段落拆开） */
const clean = (s: string) => s.replace(/<<\}/g, "<< }").replace(/\s*\n\s*/g, " ");

/** 打开某条批注的浮层：pos 是原文里的一个位置；focus 表示把光标放进输入框 */
export const openNote = StateEffect.define<{ pos: number; focus: boolean }>();
const closeNote = StateEffect.define<null>();

/** 批注署名（设置里填的；没填时用「我」） */
let author = "";
export function setNoteAuthor(name: string) { author = name.trim(); }
export const noteAuthor = () => author || "我";

/** 批注日期统一写成「11月18日」，不是今年的带上年份；卡片和右栏都用这个 */
export function fmtNoteDate(d: string) {
  const m = d.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return d;
  return +m[1] === new Date().getFullYear() ? `${+m[2]}月${+m[3]}日` : `${m[1]}年${+m[2]}月${+m[3]}日`;
}

interface Bubble { tip: Tooltip & { pos: number }; from: number; focus: boolean; freshEmpty?: boolean }

/** 去掉批注标记、原文保留：解决和删除都是这样，提示条带「撤销」 */
export function removeNote(view: EditorView, c: NoteHit, msg: string) {
  view.dispatch({ changes: { from: c.from, to: c.to, insert: c.quote }, selection: EditorSelection.cursor(c.from + c.quote.length), effects: closeNote.of(null), userEvent: "delete.note" });
  view.focus();
  notify(msg, "success", { label: "撤销", run: () => { undo(view); view.focus(); } });
}

/** 静默撤掉刚新建但没写任何内容的批注，恢复原文 */
function discardEmpty(view: EditorView, pos: number) {
  const c = noteAt(view.state, pos);
  if (c && !c.text.trim()) {
    view.dispatch({ changes: { from: c.from, to: c.to, insert: c.quote }, selection: EditorSelection.cursor(c.from + c.quote.length), effects: closeNote.of(null), userEvent: "delete.note" });
    return true;
  }
  return false;
}

function bubble(n: NoteHit, focus: boolean): Bubble {
  const mine = !n.who || n.who === noteAuthor();
  const freshEmpty = focus && !n.text.trim();
  const b: Bubble = {
    from: n.from,
    focus,
    freshEmpty,
    tip: {
      pos: n.quoteFrom,
      above: false,
      create: (view) => {
        const dom = document.createElement("div");
        dom.className = "hm-notebub";
        dom.setAttribute("role", "dialog");
        dom.setAttribute("aria-label", "批注");
        const head = document.createElement("div");
        head.className = "nb-h";
        const who = document.createElement("b");
        who.textContent = n.who || "未署名";
        const date = document.createElement("span");
        date.className = "nb-d";
        date.textContent = fmtNoteDate(n.date);
        head.append(who, date);
        /** 当前这条批注在文档里的位置（文档改过以后重新找） */
        const current = () => noteAt(view.state, b.tip.pos);
        let body: HTMLElement;
        let saved = !freshEmpty;
        if (mine) {
          // 自己的批注：看起来就是一段文字，点一下就能改，只在聚焦时出现细的聚焦框
          const ta = document.createElement("textarea");
          ta.className = "nb-tx";
          ta.rows = 1;
          ta.placeholder = "写下批注，回车完成";
          ta.value = n.text;
          ta.setAttribute("aria-label", "批注内容");
          const fit = () => {
            ta.style.height = "auto";
            const sh = ta.scrollHeight;
            ta.style.height = Math.min(200, sh) + "px";
            ta.style.overflowY = sh > 200 ? "auto" : "hidden";
          };
          ta.addEventListener("input", () => {
            fit();
            if (ta.value.trim()) saved = true;
            const c = current(); if (!c) return;
            const raw = view.state.sliceDoc(c.bodyFrom, c.bodyTo);
            const pre = raw.slice(0, parseBody(raw).prefix);
            view.dispatch({ changes: { from: c.bodyFrom, to: c.bodyTo, insert: pre + clean(ta.value) }, userEvent: "input.note" });
          });
          ta.addEventListener("keydown", (e) => {
            if (e.isComposing) return;
            if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); cancelOrDone(); }
            else if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); e.stopPropagation(); done(); }
          });
          ta.addEventListener("blur", () => setTimeout(() => {
            const a = document.activeElement;
            if (a?.closest(".hm-notebub, .hm-hmenu")) return;
            // 新建批注没写任何内容就点别处：不创建空批注，恢复原文
            if (!saved || (freshEmpty && !ta.value.trim())) {
              if (discardEmpty(view, b.tip.pos)) return;
            }
            if (!view.hasFocus) view.dispatch({ effects: closeNote.of(null) });
          }, 0));
          body = ta;
          requestAnimationFrame(fit);
        } else {
          body = document.createElement("div");
          body.className = "nb-tx ro";
          body.textContent = n.text || "还没有写内容";
          if (!n.text) body.classList.add("ph2");
        }
        const foot = document.createElement("div");
        foot.className = "nb-f";
        const more = document.createElement("button");
        more.type = "button";
        more.className = "nb-more";
        more.title = "更多";
        more.setAttribute("aria-label", "更多");
        more.innerHTML = iconSvg("dots", 16);
        more.addEventListener("mousedown", (e) => e.preventDefault());
        more.addEventListener("click", () => {
          more.classList.add("open");
          openDomMenu(more, [
            { label: "删除批注", icon: "trash", danger: true, run: () => { const c = current(); if (c) removeNote(view, c, "已删除批注，原文保留"); } },
          ], { label: "批注", onClose: () => more.classList.remove("open") });
        });
        const resolve = document.createElement("button");
        resolve.type = "button";
        resolve.className = "nb-ok";
        resolve.textContent = "解决";
        resolve.title = "去掉这条批注，原文保留";
        resolve.addEventListener("mousedown", (e) => e.preventDefault());
        resolve.addEventListener("click", () => { const c = current(); if (c) removeNote(view, c, "批注已解决"); });
        if (mine) foot.append(more);
        foot.append(resolve);
        dom.append(head, body, foot);
        const cancelOrDone = () => {
          if (freshEmpty && body instanceof HTMLTextAreaElement && !body.value.trim()) {
            discardEmpty(view, b.tip.pos);
            view.focus();
            return;
          }
          done();
        };
        const done = () => {
          if (freshEmpty && body instanceof HTMLTextAreaElement && !body.value.trim()) {
            discardEmpty(view, b.tip.pos);
            view.focus();
            return;
          }
          const c = current();
          view.focus();
          // 光标放到批注后面：浮层收起来，接着写正文
          if (c) view.dispatch({ selection: EditorSelection.cursor(c.to), effects: closeNote.of(null) });
          else view.dispatch({ effects: closeNote.of(null) });
        };
        return {
          dom,
          mount: () => { if (b.focus && body instanceof HTMLTextAreaElement) requestAnimationFrame(() => { body.focus(); body.setSelectionRange(body.value.length, body.value.length); }); },
        };
      },
    },
  };
  return b;
}

/**
 * 批注浮层。浮层里正在输入时文档一直在变，这里沿用同一个浮层对象（只更新位置），
 * 否则每打一个字浮层就重画一次，输入框会丢焦点。
 */
const bubbleField = StateField.define<Bubble | null>({
  create: () => null,
  update(v, tr) {
    if (v && tr.docChanged) { v.from = tr.changes.mapPos(v.from); v.tip.pos = tr.changes.mapPos(v.tip.pos); }
    for (const e of tr.effects) {
      if (e.is(closeNote)) return null;
      if (e.is(openNote)) {
        const n = noteAt(tr.state, e.value.pos);
        return n ? bubble(n, e.value.focus) : null;
      }
    }
    if (!tr.selection && !tr.docChanged) return v;
    const head = tr.state.selection.main.head;
    const n = tr.state.selection.main.empty ? noteAt(tr.state, head) : null;
    if (n) return v && v.from === n.from ? v : bubble(n, false);
    // 正在浮层里输入：选区没动，浮层留着
    if (v && !tr.selection && noteAt(tr.state, v.tip.pos)) return v;
    return null;
  },
  provide: (f) => showTooltip.computeN([f], (s) => { const b = s.field(f); return b ? [b.tip] : []; }),
});

/** 可见范围扩成整行后合并：批注的隐藏符号会把同一行切成几段 visibleRanges，不合并的话同一条批注会被扫两次 */
export function lineSpans(state: EditorState, ranges: readonly { from: number; to: number }[]): [number, number][] {
  const out: [number, number][] = [];
  for (const { from, to } of ranges) {
    const a = state.doc.lineAt(from).from, z = state.doc.lineAt(to).to;
    const last = out[out.length - 1];
    if (last && a <= last[1] + 1) last[1] = Math.max(last[1], z);
    else out.push([a, z]);
  }
  return out;
}

/** 批注里要整体跳过的两段：开头的 {== 和 ==}{>>…<<}，按位置排好 */
export function noteAtomRanges(state: EditorState, ranges: readonly { from: number; to: number }[]): [number, number][] {
  const out: [number, number][] = [];
  for (const [a, z] of lineSpans(state, ranges)) {
    for (const m of state.sliceDoc(a, z).matchAll(NOTE_RE)) {
      const s = a + m.index!, qe = s + 3 + m[1].length;
      out.push([s, s + 3], [qe, s + m[0].length]);
    }
  }
  return out;
}

/** 藏起来的批注符号整体跳过：光标不会停在 {== 或 ==}{>>…<<} 里面 */
const atoms = ViewPlugin.fromClass(class {
  ranges: DecorationSet;
  constructor(view: EditorView) { this.ranges = this.build(view); }
  update(u: ViewUpdate) { if (u.docChanged || u.viewportChanged) this.ranges = this.build(u.view); }
  build(view: EditorView) {
    const b = new RangeSetBuilder<Decoration>();
    const mark = Decoration.mark({});
    for (const [f, t] of noteAtomRanges(view.state, view.visibleRanges)) b.add(f, t, mark);
    return b.finish();
  }
}, { provide: (p) => EditorView.atomicRanges.of((view) => view.plugin(p)?.ranges ?? Decoration.none) });

/** 编辑时把批注原文删空、或者跨边界删掉了其中一侧符号时，自动清掉残缺的 CriticMarkup 源码，避免把 {====}{>>…<<} 泄漏到正文里 */
const noteIntegrity = EditorState.transactionFilter.of((tr) => {
  if (!tr.docChanged || tr.isUserEvent("delete.note") || tr.isUserEvent("input.note") || tr.isUserEvent("undo") || tr.isUserEvent("redo")) return tr;
  let cFrom = Infinity, cTo = -1;
  tr.changes.iterChangedRanges((fA, tA) => { if (fA < cFrom) cFrom = fA; if (tA > cTo) cTo = tA; });
  if (cTo < 0) return tr;
  const oldDoc = tr.startState.doc;
  const winFrom = Math.max(0, cFrom - 4000), winTo = Math.min(oldDoc.length, cTo + 4000);
  const oldSlice = oldDoc.sliceString(winFrom, winTo);
  const cleanups: { from: number; to: number }[] = [];
  for (const m of oldSlice.matchAll(NOTE_RE)) {
    const nf = winFrom + m.index!, nt = nf + m[0].length, qEnd = nf + 3 + m[1].length;
    if (nt < cFrom || nf > cTo) continue;
    const o0 = tr.changes.mapPos(nf, 1), o1 = tr.changes.mapPos(nf + 3, -1);
    const t0 = tr.changes.mapPos(qEnd, 1), t1 = tr.changes.mapPos(nt, -1);
    const openOk = o1 - o0 === 3 && tr.state.sliceDoc(o0, o1) === "{==";
    const tailOk = t1 - t0 >= 9 && tr.state.sliceDoc(t0, t0 + 6) === "==}{>>" && tr.state.sliceDoc(t1 - 3, t1) === "<<}";
    if (openOk && tailOk && o1 === t0) cleanups.push({ from: o0, to: t1 });
    else if (!openOk && tailOk) cleanups.push({ from: t0, to: t1 });
    else if (openOk && !tailOk) cleanups.push({ from: o0, to: o1 });
  }
  if (!cleanups.length) return tr;
  return [tr, { changes: cleanups, sequential: true }];
});

/** 正文失去焦点、而且焦点没进浮层时，收起浮层 */
const blurClose = EditorView.updateListener.of((u) => {
  if (!u.focusChanged || u.view.hasFocus) return;
  setTimeout(() => {
    if (document.activeElement?.closest(".hm-notebub, .hm-hmenu") || u.view.hasFocus) return;
    u.view.dispatch({ effects: closeNote.of(null) });
  }, 0);
});

/**
 * 页边圆点：同一行（屏幕上的一行）有几条批注就只留一个圆点、显示数字。
 * 圆点的 DOM 由 livePreview 的 NoteMarkWidget 画，这里只在布局之后按纵坐标归组。
 */
const marginDots = ViewPlugin.fromClass(class {
  constructor(readonly view: EditorView) { this.schedule(); }
  update(u: ViewUpdate) { if (u.docChanged || u.viewportChanged || u.geometryChanged) this.schedule(); }
  schedule() {
    this.view.requestMeasure({
      // 按零宽占位（.hm-notemark）的位置归组：它跟着文字走，不受圆点自己样式（数字块更高）的影响
      read: (v) => [...v.contentDOM.querySelectorAll<HTMLElement>(".hm-notemark i")].map((el) => ({ el, top: Math.round(el.parentElement!.getBoundingClientRect().top) })),
      write: (dots) => {
        const groups = new Map<number, HTMLElement[]>();
        for (const d of dots) { const k = [...groups.keys()].find((t) => Math.abs(t - d.top) < 4) ?? d.top; groups.set(k, [...(groups.get(k) || []), d.el]); }
        for (const g of groups.values()) g.forEach((el, i) => {
          el.classList.toggle("dup", i > 0);
          if (i === 0 && g.length > 1) el.dataset.n = String(g.length); else delete el.dataset.n;
        });
      },
    });
  }
});

/** 浮层（以及其他编辑器浮层）只在正文栏里横向移动，放不下下方就翻到上方（B4） */
const tooltipSpace = tooltips({
  tooltipSpace: (view) => {
    const r = view.contentDOM.getBoundingClientRect();
    return { top: 0, left: r.left, bottom: innerHeight, right: r.right };
  },
});

export function notes(): Extension {
  return [bubbleField, atoms, noteIntegrity, blurClose, marginDots, tooltipSpace];
}

/* ---------------- 批注选区校验与规整 ---------------- */

const LINE_PREFIX = /^(?:[ \t]*(?:>[ \t]?|#{1,6}[ \t]+|[-*+][ \t]+\[[ xX]\][ \t]+|[-*+][ \t]+|\d+[.)][ \t]+))*[ \t]*/;
const BLOCK_START = /^[ \t]*(?:#{1,6}[ \t]|>[ \t]?|[-*+][ \t]|\d+[.)][ \t]|```|~~~|\$\$|\||(?:---|\*\*\*|___)[ \t]*$)/;
const FORBIDDEN_BLOCKS: Record<string, string> = {
  FencedCode: "不能在代码块里添加批注",
  CodeBlock: "不能在代码块里添加批注",
  Table: "暂不支持在表格源码里添加批注",
  HorizontalRule: "不能给分隔线加批注",
  HTMLBlock: "不能给 HTML 或注释块加批注",
  CommentBlock: "不能给 HTML 或注释块加批注",
};
const PAIRED_INLINE: Record<string, string> = {
  StrongEmphasis: "EmphasisMark",
  Emphasis: "EmphasisMark",
  Strikethrough: "StrikethroughMark",
  Highlight: "HighlightMark",
  Superscript: "SuperscriptMark",
  Subscript: "SubscriptMark",
};
const SYNTAX_MARKS = new Set([
  "EmphasisMark", "CodeMark", "StrikethroughMark", "SuperscriptMark", "SubscriptMark",
  "HighlightMark", "HeaderMark", "QuoteMark", "ListMark", "TaskMarker", "LinkMark", "URL", "LinkTitle",
]);
const PROSE_BLOCK = new Set(["Paragraph", "ListItem", "ATXHeading1", "ATXHeading2", "ATXHeading3", "ATXHeading4", "ATXHeading5", "ATXHeading6", "SetextHeading1", "SetextHeading2"]);
const CTRL_CHAR_RE = /[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/;
const CRITIC_DELIM_RE = /\{==|==\}|\{>>|<<\}/;

/** 文档开头的 YAML 属性区结束位置（没有时返回 -1） */
function frontmatterEnd(state: EditorState): number {
  const doc = state.doc;
  if (doc.lines < 2 || doc.line(1).text !== "---") return -1;
  for (let i = 2; i <= doc.lines; i++) if (/^(---|\.\.\.)\s*$/.test(doc.line(i).text)) return doc.line(i).to;
  return -1;
}

/** [from, to] 是否碰到 $$…$$ 公式块 */
function touchesMathBlock(state: EditorState, from: number, to: number, tree: ReturnType<typeof syntaxTree>): boolean {
  const doc = state.doc;
  const fmEnd = frontmatterEnd(state);
  const inCode = (p: number) => {
    for (let n: SyntaxNode | null = tree.resolveInner(p, 1); n; n = n.parent) if (n.name === "FencedCode" || n.name === "CodeBlock") return true;
    return false;
  };
  let open = -1;
  for (let i = 1; i <= doc.lines; i++) {
    const L = doc.line(i);
    if (fmEnd >= 0 && L.to <= fmEnd) continue;
    const t = L.text.trim();
    if (open >= 0) {
      if (t === "$$") {
        if (from <= L.to && to >= open) return true;
        open = -1;
      }
      continue;
    }
    if (!t.startsWith("$$") || inCode(L.from)) continue;
    if (t.length > 4 && t.endsWith("$$")) { if (from <= L.to && to >= L.from) return true; }
    else if (t === "$$") open = L.from;
  }
  return false;
}

function proseContainer(tree: ReturnType<typeof syntaxTree>, pos: number, side: 1 | -1): SyntaxNode | null {
  for (let n: SyntaxNode | null = tree.resolveInner(pos, side); n; n = n.parent) if (PROSE_BLOCK.has(n.name)) return n;
  return null;
}

/**
 * 校验并规整要加批注的选区：
 * - 拒绝已有批注/嵌套批注、批注源码符号、代码块/公式块/属性区/表格/分隔线/跨段落选区；
 * - 自动裁掉行首的块级标记（# 、> 、- [ ] 等）和首尾空白，以及贴在选区边缘的单个格式符号；
 * - 拒绝截断行内代码/公式/链接/引用/成对格式符号，或只选中控制字符与 Markdown 格式符号的情况。
 */
export function resolveNoteRange(state: EditorState, rawFrom: number, rawTo: number): { ok: true; from: number; to: number } | { ok: false; reason: string } {
  let from = Math.min(rawFrom, rawTo), to = Math.max(rawFrom, rawTo);
  if (from >= to) return { ok: false, reason: "先选中要批注的文字" };

  // 1. 已有批注重叠或包含批注源码符号：禁止重复/嵌套批注或给批注源码加批注
  const winFrom = Math.max(0, from - 8000), winTo = Math.min(state.doc.length, to + 8000);
  const winText = state.sliceDoc(winFrom, winTo);
  for (const m of winText.matchAll(NOTE_RE)) {
    const nf = winFrom + m.index!, nt = nf + m[0].length;
    if (from < nt && to > nf) return { ok: false, reason: "这段文字已有批注，不能重复或嵌套批注" };
  }
  if (CRITIC_DELIM_RE.test(state.sliceDoc(from, to))) return { ok: false, reason: "不能给批注符号加批注" };

  // 2. 属性区、公式块、代码块、表格、分隔线、HTML 块
  const fmEnd = frontmatterEnd(state);
  if (fmEnd >= 0 && from <= fmEnd) return { ok: false, reason: "不能在属性区里添加批注" };
  const tree = ensureSyntaxTree(state, Math.min(state.doc.length, to + 1), 200) ?? syntaxTree(state);
  if (touchesMathBlock(state, from, to, tree)) return { ok: false, reason: "不能在公式块里添加批注" };
  for (const [p, side] of [[from, 1], [Math.max(from, to - 1), -1]] as const) {
    for (let n: SyntaxNode | null = tree.resolveInner(p, side); n; n = n.parent) {
      if (FORBIDDEN_BLOCKS[n.name]) return { ok: false, reason: FORBIDDEN_BLOCKS[n.name] };
    }
  }
  let badBetween = "";
  tree.iterate({ from, to, enter: (n) => { if (FORBIDDEN_BLOCKS[n.name]) { badBetween = FORBIDDEN_BLOCKS[n.name]; return false; } } });
  if (badBetween) return { ok: false, reason: "请在同一段文字内添加批注" };

  // 3. 跨段落 / 跨块检查
  if (/\n[ \t]*\n/.test(state.sliceDoc(from, to))) return { ok: false, reason: "请在同一段文字内添加批注" };
  const startLine = state.doc.lineAt(from), endLine = state.doc.lineAt(to);
  if (startLine.number !== endLine.number) {
    const a = proseContainer(tree, from, 1), b = proseContainer(tree, Math.max(from, to - 1), -1);
    if (a && b && (a.from !== b.from || a.to !== b.to)) return { ok: false, reason: "请在同一段文字内添加批注" };
    if (a && /^ATXHeading|^SetextHeading/.test(a.name)) return { ok: false, reason: "请在同一段文字内添加批注" };
    for (let ln = startLine.number + 1; ln <= endLine.number; ln++) {
      if (BLOCK_START.test(state.doc.line(ln).text)) return { ok: false, reason: "请在同一段文字内添加批注" };
    }
  }

  // 4. 整行图片 / 整行文件卡片
  if (startLine.number === endLine.number) {
    const lt = startLine.text.trim();
    if (/^!\[[^\]]*\]\([^)]*\)(\{[^}]*\})?$/.test(lt)) return { ok: false, reason: "不能给图片加批注" };
    const fm = lt.match(/^\[([^\]]*)\]\((<[^>]+>|[^)\s]+)\)$/);
    if (fm && !/^\[@/.test(lt)) {
      const href = fm[2].replace(/^<|>$/g, "");
      let dec = href;
      try { dec = decodeURI(href); } catch { /* 原样用 */ }
      if (!/^[a-z][a-z0-9+.-]*:/i.test(href) && CARD_EXT.test(dec)) return { ok: false, reason: "不能给文件卡片加批注" };
    }
  }

  // 5. 自动裁掉行首的块级控制前缀（# 、> 、- [ ] 、1. 、[^1]: ）、标题末尾 {#id} 与首尾空白
  const preEnd = startLine.from + (startLine.text.match(LINE_PREFIX)?.[0].length ?? 0);
  if (from < preEnd) from = Math.min(preEnd, to);
  const fnDef = startLine.text.match(/^\[\^[^\]\s]+\]:[ \t]*/);
  if (fnDef && from < startLine.from + fnDef[0].length) from = Math.min(startLine.from + fnDef[0].length, to);
  if (/^#{1,6}[ \t]/.test(endLine.text)) {
    const attr = endLine.text.match(HEADING_ATTR);
    if (attr && to > endLine.from + attr.index!) to = Math.max(from, endLine.from + attr.index!);
  }
  const trimWs = () => {
    while (from < to && /\s/.test(state.sliceDoc(from, from + 1))) from++;
    while (to > from && /\s/.test(state.sliceDoc(to - 1, to))) to--;
  };
  trimWs();
  if (from >= to) return { ok: false, reason: "不能只给格式符号或控制字符加批注" };

  // 6. 禁止控制字符
  if (CTRL_CHAR_RE.test(state.sliceDoc(from, to))) return { ok: false, reason: "不能给控制字符加批注" };

  // 7. 不可拆分的行内元素（行内代码、行内公式、链接地址、图片、引用、脚注）
  const lineFrom = startLine.from, lineTo = endLine.to;
  const lineText = state.sliceDoc(lineFrom, lineTo);
  const codeSpans: [number, number][] = [];
  const atomsWholeOk: [number, number][] = []; // 完整包住整个元素时允许，但不能落入内部或截断边界
  const atomsForbid: [number, number][] = []; // 即使完整选中也不允许批注（URL、图片、HTML 标签、脚注引用）
  const paired: { from: number; to: number; openEnd: number; closeStart: number }[] = [];
  const markSpans: [number, number][] = [];

  tree.iterate({
    from: lineFrom, to: lineTo,
    enter: (n) => {
      if (n.name === "InlineCode") { codeSpans.push([n.from, n.to]); atomsWholeOk.push([n.from, n.to]); return; }
      if (n.name === "Image" || n.name === "URL" || n.name === "LinkTitle" || n.name === "Autolink" || n.name === "HTMLTag") {
        atomsForbid.push([n.from, n.to]);
      }
      if (SYNTAX_MARKS.has(n.name)) markSpans.push([n.from, n.to]);
      const mkName = PAIRED_INLINE[n.name];
      if (mkName) {
        const mks = n.node.getChildren(mkName);
        if (mks.length >= 2 && mks[0].from === n.from && mks[mks.length - 1].to === n.to) {
          paired.push({ from: n.from, to: n.to, openEnd: mks[0].to, closeStart: mks[mks.length - 1].from });
        }
      }
    },
  });
  const inCode = (p: number) => codeSpans.some(([a, z]) => p >= a && p < z);
  for (const m of lineText.matchAll(/(^|[^\\$])\$([^$\n]+?)\$(?!\$)/g)) {
    const a = lineFrom + m.index! + m[1].length, z = a + m[2].length + 2;
    if (!inCode(a)) atomsWholeOk.push([a, z]);
  }
  for (const m of lineText.matchAll(/\[@[\w:.-]+(?:\s*;\s*@[\w:.-]+)*\]/g)) {
    const a = lineFrom + m.index!, z = a + m[0].length;
    if (!inCode(a)) atomsWholeOk.push([a, z]);
  }
  for (const m of lineText.matchAll(/\[\^[^\]\s]+\]/g)) {
    const a = lineFrom + m.index!, z = a + m[0].length;
    if (!inCode(a)) atomsForbid.push([a, z]);
  }

  // 8. 裁掉刚好落在选区两端的半个成对格式符号（例如只多选了开头的 ** 或结尾的 **）
  for (let pass = 0; pass < 4; pass++) {
    const prevF = from, prevT = to;
    for (const p of paired) {
      if (from >= p.from && from < p.openEnd && to < p.to) from = Math.min(p.openEnd, to);
      if (from >= p.closeStart && from < p.to && to > p.to) from = Math.min(p.to, to);
      if (to > p.closeStart && to <= p.to && from > p.from) to = Math.max(from, p.closeStart);
      if (to > p.from && to <= p.openEnd && from < p.from) to = Math.max(from, p.from);
    }
    trimWs();
    if (from === prevF && to === prevT) break;
  }
  if (from >= to) return { ok: false, reason: "不能只给格式符号或控制字符加批注" };

  // 检查禁止的原子元素与不可截断的行内元素
  for (const [a, z] of atomsForbid) {
    if (from < z && to > a) {
      if (from >= a && to <= z) return { ok: false, reason: "不能给链接地址、图片或控制符号加批注" };
      // 如果整个 [text](url) 链接都在选区里，允许批注整条链接；否则不能只截到 URL
      let linkWraps = false;
      tree.iterate({ from: lineFrom, to: lineTo, enter: (n) => { if (n.name === "Link" && n.from >= from && n.to <= to && a >= n.from && z <= n.to) linkWraps = true; } });
      if (!linkWraps) return { ok: false, reason: "选区不能截断链接、图片或脚注语法" };
    }
  }
  for (const [a, z] of atomsWholeOk) {
    if (from < z && to > a && !(from <= a && to >= z)) {
      if (from >= a && to <= z) return { ok: false, reason: "不能在行内代码、公式或引用内部加批注" };
      return { ok: false, reason: "选区不能截断行内代码、公式或引用" };
    }
  }
  // 检查链接边界（不能从 [文字] 内部跨过 ]( 拖到外部）
  let splitLink = false;
  tree.iterate({
    from: lineFrom, to: lineTo,
    enter: (n) => {
      if (n.name !== "Link") return;
      if (from < n.to && to > n.from) {
        if (from <= n.from && to >= n.to) return; // 完整包住整条链接，允许
        const marks = n.node.getChildren("LinkMark");
        if (marks.length >= 2) {
          const textFrom = marks[0].to, textTo = marks[1].from;
          if (from >= textFrom && to <= textTo) return; // 纯粹在链接可见文字内部，允许
        }
        splitLink = true;
      }
    },
  });
  if (splitLink) return { ok: false, reason: "选区不能截断链接语法" };

  // 检查是否仍然把某个成对格式（**…**、*…*、~~…~~ 等）从中间劈开
  for (const p of paired) {
    const insideStart = from > p.from && from < p.to;
    const insideEnd = to > p.from && to < p.to;
    if ((insideStart && to > p.to) || (insideEnd && from < p.from)) {
      return { ok: false, reason: "选区不能截断加粗、斜体等格式符号" };
    }
  }

  // 9. 去掉所有 Markdown 语法符号后，必须至少保留一个可见字符
  let visible = "";
  for (let pos = from; pos < to; pos++) {
    if (markSpans.some(([a, z]) => pos >= a && pos < z)) continue;
    visible += state.sliceDoc(pos, pos + 1);
  }
  if (!visible.trim()) return { ok: false, reason: "不能只给格式符号或控制字符加批注" };

  return { ok: true, from, to };
}

/** 给选中的文字加批注：校验并规整选区后插入 CriticMarkup，直接弹出卡片、光标在输入框里 */
export function insertNote(view: EditorView, who: string = noteAuthor()) {
  const r = view.state.selection.main;
  const res = resolveNoteRange(view.state, r.from, r.to);
  if (!res.ok) {
    notify(res.reason, "warn");
    return false;
  }
  const d = new Date();
  const date = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  const quote = view.state.sliceDoc(res.from, res.to);
  const insert = `{==${quote}==}{>>@${who} ${date}：<<}`;
  view.dispatch({ changes: { from: res.from, to: res.to, insert }, selection: EditorSelection.cursor(res.from + 3 + quote.length) });
  view.dispatch({ effects: openNote.of({ pos: res.from + 3, focus: true }) });
  return true;
}
