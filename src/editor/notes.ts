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
import { undo } from "@codemirror/commands";
import { iconSvg } from "../lib/icons";
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

interface Bubble { tip: Tooltip & { pos: number }; from: number; focus: boolean }

/** 去掉批注标记、原文保留：解决和删除都是这样，提示条带「撤销」 */
export function removeNote(view: EditorView, c: NoteHit, msg: string) {
  view.dispatch({ changes: { from: c.from, to: c.to, insert: c.quote }, selection: EditorSelection.cursor(c.from + c.quote.length), effects: closeNote.of(null), userEvent: "delete.note" });
  view.focus();
  notify(msg, "success", { label: "撤销", run: () => { undo(view); view.focus(); } });
}

function bubble(n: NoteHit, focus: boolean): Bubble {
  const mine = !n.who || n.who === noteAuthor();
  const b: Bubble = {
    from: n.from,
    focus,
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
        if (mine) {
          // 自己的批注：看起来就是一段文字，点一下就能改，只在聚焦时出现细的聚焦框
          const ta = document.createElement("textarea");
          ta.className = "nb-tx";
          ta.rows = 1;
          ta.placeholder = "写下批注，回车完成";
          ta.value = n.text;
          ta.setAttribute("aria-label", "批注内容");
          const fit = () => { ta.style.height = "auto"; ta.style.height = Math.min(200, ta.scrollHeight) + "px"; };
          ta.addEventListener("input", () => {
            fit();
            const c = current(); if (!c) return;
            const raw = view.state.sliceDoc(c.bodyFrom, c.bodyTo);
            const pre = raw.slice(0, parseBody(raw).prefix);
            view.dispatch({ changes: { from: c.bodyFrom, to: c.bodyTo, insert: pre + clean(ta.value) }, userEvent: "input.note" });
          });
          ta.addEventListener("keydown", (e) => {
            if (e.isComposing) return;
            if ((e.key === "Enter" && !e.shiftKey) || e.key === "Escape") { e.preventDefault(); e.stopPropagation(); done(); }
          });
          ta.addEventListener("blur", () => setTimeout(() => {
            const a = document.activeElement;
            if (!a?.closest(".hm-notebub, .hm-hmenu") && !view.hasFocus) view.dispatch({ effects: closeNote.of(null) });
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
        const done = () => {
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
  return [bubbleField, atoms, blurClose, marginDots, tooltipSpace];
}

/** 给选中的文字加批注：插入 CriticMarkup，直接弹出卡片、光标在输入框里 */
export function insertNote(view: EditorView, who: string = noteAuthor()) {
  const r = view.state.selection.main;
  if (r.empty) return false;
  const d = new Date();
  const date = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  const quote = view.state.sliceDoc(r.from, r.to);
  const insert = `{==${quote}==}{>>@${who} ${date}：<<}`;
  view.dispatch({ changes: { from: r.from, to: r.to, insert }, selection: EditorSelection.cursor(r.from + 3 + quote.length) });
  view.dispatch({ effects: openNote.of({ pos: r.from + 3, focus: true }) });
  return true;
}
