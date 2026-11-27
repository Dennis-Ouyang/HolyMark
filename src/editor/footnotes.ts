/**
 * 脚注（G10）：正文里的 [^1] 渲染成上标编号，悬停浮出脚注内容；
 * 文末的定义行 [^1]: 内容 渲染成小一号的「1 内容」。导出时 Pandoc 本来就支持脚注，这里只管编辑器里的样子。
 * 光标进到引用或定义行时显示源码（和其他行内格式一样，由 livePreview 的 active 决定）。
 */
import type { EditorState, Range } from "@codemirror/state";
import { Decoration, EditorView, WidgetType } from "@codemirror/view";

/** 正文里的脚注引用（不在行首，或者行首但后面不是冒号） */
export const FN_REF = /\[\^([^\]\s]+)\](?!:)/g;
/** 定义行 */
export const FN_DEF = /^\[\^([^\]\s]+)\]:\s*/;

/** 找脚注 id 的内容（定义行，以及它后面缩进的续行） */
export function footnoteText(state: EditorState, id: string): string | null {
  const doc = state.doc;
  for (let i = 1; i <= doc.lines; i++) {
    const l = doc.line(i).text;
    const m = l.match(FN_DEF);
    if (!m || m[1] !== id) continue;
    const parts = [l.slice(m[0].length)];
    for (let k = i + 1; k <= doc.lines && /^(\s{2,}|\t)\S/.test(doc.line(k).text); k++) parts.push(doc.line(k).text.trim());
    return parts.join(" ").trim();
  }
  return null;
}

let tip: HTMLElement | null = null;
function hideTip() { tip?.remove(); tip = null; }

class FnRefWidget extends WidgetType {
  constructor(readonly id: string) { super(); }
  eq(o: FnRefWidget) { return o.id === this.id; }
  toDOM(view: EditorView) {
    const el = document.createElement("sup");
    el.className = "hm-fn";
    el.textContent = this.id;
    let t = 0;
    el.addEventListener("mouseenter", () => {
      t = window.setTimeout(() => {
        hideTip();
        const text = footnoteText(view.state, this.id);
        const box = document.createElement("div");
        box.className = "hm-fntip";
        box.textContent = text ?? `还没有写脚注 [^${this.id}] 的内容`;
        document.body.append(box);
        const r = el.getBoundingClientRect(), b = box.getBoundingClientRect();
        box.style.left = Math.round(Math.max(8, Math.min(r.left - 12, innerWidth - b.width - 8))) + "px";
        box.style.top = Math.round(r.bottom + 6 + b.height < innerHeight ? r.bottom + 6 : r.top - 6 - b.height) + "px";
        tip = box;
      }, 300);
    });
    el.addEventListener("mouseleave", () => { clearTimeout(t); hideTip(); });
    el.addEventListener("mousedown", (e) => {
      e.preventDefault();
      view.dispatch({ selection: { anchor: Math.min(view.posAtDOM(el) + 2, view.state.doc.length) } });
      view.focus();
    });
    return el;
  }
  destroy() { hideTip(); }
  ignoreEvent() { return true; }
}

class FnDefWidget extends WidgetType {
  constructor(readonly id: string) { super(); }
  eq(o: FnDefWidget) { return o.id === this.id; }
  toDOM() {
    const el = document.createElement("span");
    el.className = "hm-fndef-n";
    el.textContent = this.id;
    return el;
  }
}

/**
 * 一段文字里的脚注装饰（livePreview 的 inlineDecos 调用）。free(from, to) 判断这段有没有被别的装饰占用。
 * active 时只给引用加个颜色，显示源码。
 */
export function footnoteDecos(state: EditorState, from: number, to: number, active: boolean, decos: Range<Decoration>[], free: (f: number, t: number) => boolean, taken: [number, number][]) {
  const text = state.sliceDoc(from, to);
  // 定义行
  const first = state.doc.lineAt(from);
  if (first.from === from) {
    const m = first.text.match(FN_DEF);
    if (m) {
      decos.push(Decoration.line({ class: "hm-fndef" }).range(first.from));
      if (!active) { decos.push(Decoration.replace({ widget: new FnDefWidget(m[1]) }).range(first.from, first.from + m[0].length)); taken.push([first.from, first.from + m[0].length]); }
    }
  }
  FN_REF.lastIndex = 0;
  for (let m: RegExpExecArray | null; (m = FN_REF.exec(text)); ) {
    const f = from + m.index, t = f + m[0].length;
    if (state.doc.lineAt(f).from === f && state.sliceDoc(t, t + 1) === ":") continue;
    if (active) decos.push(Decoration.mark({ class: "hm-fn-src" }).range(f, t));
    else if (free(f, t)) { decos.push(Decoration.replace({ widget: new FnRefWidget(m[1]) }).range(f, t)); taken.push([f, t]); }
  }
}
