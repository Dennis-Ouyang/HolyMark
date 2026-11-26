/**
 * 图形化的批注。文件里仍是标准的 CriticMarkup：{==原文==}{>>@作者 日期：内容<<}，AI 和别的编辑器都读得懂；
 * 但在 HolyMark 里看不到这些符号：
 * - 正文只显示高亮的原文，后面一个小批注图标（符号由 livePreview 藏起来，这里把藏起来的部分设成整体跳过）；
 * - 光标落在批注过的文字上（或点那个小图标）时，下方浮出批注卡片：作者、日期、能直接改的内容、「解决」；
 * - 添加批注时卡片直接弹出，光标在输入框里，写完回车。
 */
import { EditorSelection, EditorState, Extension, RangeSetBuilder, StateEffect, StateField } from "@codemirror/state";
import { Decoration, DecorationSet, EditorView, showTooltip, Tooltip, ViewPlugin, ViewUpdate } from "@codemirror/view";
import { iconSvg } from "../lib/icons";

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

/** 打开某条批注的卡片：pos 是原文里的一个位置；focus 表示把光标放进输入框 */
export const openNote = StateEffect.define<{ pos: number; focus: boolean }>();
const closeNote = StateEffect.define<null>();

interface Bubble { tip: Tooltip & { pos: number }; from: number; focus: boolean }

function fmtDate(d: string) {
  const m = d.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return d;
  return +m[1] === new Date().getFullYear() ? `${+m[2]}月${+m[3]}日` : `${m[1]}年${+m[2]}月${+m[3]}日`;
}

function bubble(state: EditorState, n: NoteHit, focus: boolean, avatar: (who: string) => string): Bubble {
  const b: Bubble = {
    from: n.from,
    focus,
    tip: {
      pos: n.quoteFrom,
      above: false,
      create: (view) => {
        const dom = document.createElement("div");
        dom.className = "hm-notebub";
        const head = document.createElement("div");
        head.className = "nb-h";
        const av = document.createElement("span");
        av.className = "av";
        av.style.background = avatar(n.who);
        av.textContent = (n.who || "?").slice(0, 1);
        const who = document.createElement("b");
        who.textContent = n.who || "未署名";
        const date = document.createElement("span");
        date.className = "nb-d";
        date.textContent = fmtDate(n.date);
        const resolve = document.createElement("button");
        resolve.type = "button";
        resolve.className = "nb-ok";
        resolve.title = "解决：去掉这条批注，原文保留";
        resolve.innerHTML = iconSvg("check", 14) + "<span>解决</span>";
        head.append(av, who, date, resolve);
        const ta = document.createElement("textarea");
        ta.rows = 1;
        ta.placeholder = "写下批注，回车完成";
        ta.value = n.text;
        ta.setAttribute("aria-label", "批注内容");
        const fit = () => { ta.style.height = "auto"; ta.style.height = Math.min(160, ta.scrollHeight) + "px"; };
        dom.append(head, ta);

        /** 当前这条批注在文档里的位置（文档改过以后重新找） */
        const current = () => noteAt(view.state, b.tip.pos);
        ta.addEventListener("input", () => {
          fit();
          const c = current(); if (!c) return;
          const body = view.state.sliceDoc(c.bodyFrom, c.bodyTo);
          const pre = body.slice(0, parseBody(body).prefix);
          view.dispatch({ changes: { from: c.bodyFrom, to: c.bodyTo, insert: pre + clean(ta.value) }, userEvent: "input.note" });
        });
        const done = () => {
          const c = current();
          view.focus();
          // 光标放到批注后面：卡片收起来，接着写正文
          if (c) view.dispatch({ selection: EditorSelection.cursor(c.to), effects: closeNote.of(null) });
          else view.dispatch({ effects: closeNote.of(null) });
        };
        ta.addEventListener("keydown", (e) => {
          if (e.isComposing) return;
          if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); done(); }
          if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); done(); }
        });
        // 焦点离开卡片又没回到正文：收起卡片
        ta.addEventListener("blur", () => setTimeout(() => {
          const a = document.activeElement;
          if (!a?.closest(".hm-notebub") && !view.hasFocus) view.dispatch({ effects: closeNote.of(null) });
        }, 0));
        resolve.addEventListener("mousedown", (e) => e.preventDefault());
        resolve.addEventListener("click", () => {
          const c = current(); if (!c) return;
          view.dispatch({ changes: { from: c.from, to: c.to, insert: c.quote }, selection: EditorSelection.cursor(c.from + c.quote.length), effects: closeNote.of(null) });
          view.focus();
        });
        return {
          dom,
          mount: () => { fit(); if (b.focus) requestAnimationFrame(() => { ta.focus(); ta.setSelectionRange(ta.value.length, ta.value.length); }); },
        };
      },
    },
  };
  return b;
}

/**
 * 批注卡片。卡片里正在输入时文档一直在变，这里沿用同一个卡片对象（只更新位置），
 * 否则每打一个字卡片就重画一次，输入框会丢焦点。
 */
function bubbleField(avatar: (who: string) => string) {
  return StateField.define<Bubble | null>({
    create: () => null,
    update(v, tr) {
      if (v && tr.docChanged) { v.from = tr.changes.mapPos(v.from); v.tip.pos = tr.changes.mapPos(v.tip.pos); }
      for (const e of tr.effects) {
        if (e.is(closeNote)) return null;
        if (e.is(openNote)) {
          const n = noteAt(tr.state, e.value.pos);
          return n ? bubble(tr.state, n, e.value.focus, avatar) : null;
        }
      }
      if (!tr.selection && !tr.docChanged) return v;
      const head = tr.state.selection.main.head;
      const n = tr.state.selection.main.empty ? noteAt(tr.state, head) : null;
      if (n) return v && v.from === n.from ? v : bubble(tr.state, n, false, avatar);
      // 正在卡片里输入：选区没动，卡片留着
      if (v && !tr.selection && noteAt(tr.state, v.tip.pos)) return v;
      return null;
    },
    provide: (f) => showTooltip.computeN([f], (s) => { const b = s.field(f); return b ? [b.tip] : []; }),
  });
}

/** 藏起来的批注符号整体跳过：光标不会停在 {== 或 ==}{>>…<<} 里面 */
const atoms = ViewPlugin.fromClass(class {
  ranges: DecorationSet;
  constructor(view: EditorView) { this.ranges = this.build(view); }
  update(u: ViewUpdate) { if (u.docChanged || u.viewportChanged) this.ranges = this.build(u.view); }
  build(view: EditorView) {
    const b = new RangeSetBuilder<Decoration>();
    const mark = Decoration.mark({});
    // 几段可见区间扩成整行后可能重叠，已经加过的位置跳过，免得顺序乱掉
    let done = -1;
    for (const { from, to } of view.visibleRanges) {
      const a = Math.max(view.state.doc.lineAt(from).from, done), z = view.state.doc.lineAt(to).to;
      if (a >= z) continue;
      for (const m of view.state.sliceDoc(a, z).matchAll(NOTE_RE)) {
        const s = a + m.index!, qe = s + 3 + m[1].length;
        done = s + m[0].length;
        b.add(s, s + 3, mark);
        b.add(qe, s + m[0].length, mark);
      }
    }
    return b.finish();
  }
}, { provide: (p) => EditorView.atomicRanges.of((view) => view.plugin(p)?.ranges ?? Decoration.none) });

/** 正文失去焦点、而且焦点没进卡片时，收起卡片 */
const blurClose = EditorView.updateListener.of((u) => {
  if (!u.focusChanged || u.view.hasFocus) return;
  setTimeout(() => {
    if (document.activeElement?.closest(".hm-notebub") || u.view.hasFocus) return;
    u.view.dispatch({ effects: closeNote.of(null) });
  }, 0);
});

export function notes(avatar: (who: string) => string): Extension {
  return [bubbleField(avatar), atoms, blurClose];
}

/** 给选中的文字加批注：插入 CriticMarkup，直接弹出卡片、光标在输入框里 */
export function insertNote(view: EditorView, author: string) {
  const r = view.state.selection.main;
  if (r.empty) return false;
  const d = new Date();
  const date = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  const quote = view.state.sliceDoc(r.from, r.to);
  const insert = `{==${quote}==}{>>@${author} ${date}：<<}`;
  view.dispatch({ changes: { from: r.from, to: r.to, insert }, selection: EditorSelection.cursor(r.from + 3 + quote.length) });
  view.dispatch({ effects: openNote.of({ pos: r.from + 3, focus: true }) });
  return true;
}
