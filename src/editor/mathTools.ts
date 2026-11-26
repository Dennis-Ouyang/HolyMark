/**
 * 公式编辑：
 * - 光标在行内公式 $…$ 或行间公式 $$…$$ 里时，下方浮出渲染结果；写错时显示哪里错了。
 * - 行间公式编号：按全文里行间公式的先后编号，标在屏幕上的公式右侧（编辑器只渲染屏幕附近的内容，
 *   用 CSS 计数器的话长文滚到中间会从 1 重新数，所以这里按位置算）。是否显示由设置控制。
 */
import { EditorState, Extension, StateField } from "@codemirror/state";
import { EditorView, showTooltip, Tooltip, ViewPlugin, ViewUpdate } from "@codemirror/view";
import katex from "katex";
import { setFocus, topBlocks } from "./livePreview";
import { iconSvg } from "../lib/icons";

interface MathAt { from: number; to: number; tex: string; display: boolean }

/** 光标所在的公式（没有就是 null） */
export function mathAt(state: EditorState): MathAt | null {
  const r = state.selection.main;
  const doc = state.doc;
  const line = doc.lineAt(r.head);
  // 行内：这一行里包住光标的 $…$
  for (const m of line.text.matchAll(/(?<![\\$])\$([^$\n]+?)\$(?!\$)/g)) {
    const from = line.from + m.index!, to = from + m[0].length;
    if (r.head > from && r.head < to) return { from, to, tex: m[1], display: false };
  }
  // 行间：单行的 $$…$$，或往上下找配对的 $$
  const t = line.text.trim();
  if (t.startsWith("$$") && t.endsWith("$$") && t.length > 4) return { from: line.from, to: line.to, tex: t.slice(2, -2), display: true };
  let start = -1, end = -1;
  for (let n = line.number, k = 0; n >= 1 && k < 60; n--, k++) {
    const lt = doc.line(n).text.trim();
    if (lt === "$$") { start = n; break; }
    if (n !== line.number && !lt) return null; // 空行：不在公式块里
  }
  if (start < 0) return null;
  for (let n = Math.max(start + 1, line.number), k = 0; n <= doc.lines && k < 60; n++, k++) {
    if (doc.line(n).text.trim() === "$$" && n !== start) { end = n; break; }
  }
  if (end < 0 || line.number > end) return null;
  // 往上找到的 $$ 可能是上一个公式的结尾：它前面单独成行的 $$ 是奇数个，就不是开头
  if ((state.sliceDoc(0, doc.line(start).from).match(/^[ \t]*\$\$[ \t]*$/gm) || []).length % 2 === 1) return null;
  const from = doc.line(start).from, to = doc.line(end).to;
  return { from, to, tex: state.sliceDoc(doc.line(start).to + 1, doc.line(end).from - 1), display: true };
}

const focusOf = (s: EditorState) => s.field(focused, false) ?? false;
const focused = StateField.define<boolean>({
  create: () => false,
  update: (v, tr) => { for (const e of tr.effects) if (e.is(setFocus)) return e.value; return v; },
});

const mathTip = StateField.define<Tooltip | null>({
  create: () => null,
  update(v, tr) {
    if (!tr.docChanged && !tr.selection && !tr.effects.some((e) => e.is(setFocus))) return v;
    const st = tr.state;
    if (!focusOf(st) || !st.selection.main.empty) return null;
    const m = mathAt(st);
    if (!m || !m.tex.trim()) return null;
    return {
      pos: m.display ? m.to : m.from,
      above: false,
      arrow: true,
      create: () => {
        const dom = document.createElement("div");
        dom.className = "hm-mathtip" + (m.display ? " display" : "");
        try {
          katex.render(m.tex, dom, { displayMode: m.display, throwOnError: true, output: "html" });
        } catch (e) {
          dom.classList.add("err");
          const msg = String((e as Error).message || e).replace(/^KaTeX parse error:\s*/, "");
          dom.textContent = "";
          const b = document.createElement("b"); b.textContent = "公式有误";
          const s = document.createElement("span"); s.textContent = msg;
          dom.append(b, s);
        }
        // 右上角的小按钮：打开公式符号面板（N12）
        const sym = document.createElement("button");
        sym.type = "button";
        sym.className = "hm-mt-sym";
        sym.title = "公式符号";
        sym.setAttribute("aria-label", "公式符号");
        sym.innerHTML = iconSvg("symbols", 13);
        sym.addEventListener("mousedown", (e) => {
          e.preventDefault();
          window.dispatchEvent(new CustomEvent("hm-symbols", { detail: sym.getBoundingClientRect() }));
        });
        dom.appendChild(sym);
        return { dom };
      },
    };
  },
  provide: (f) => showTooltip.from(f),
});

/** 行间公式在全文里是第几个 */
const numbering = ViewPlugin.fromClass(class {
  starts: number[] = [];
  constructor(view: EditorView) { this.index(view.state); this.mark(view); }
  update(u: ViewUpdate) {
    if (u.docChanged) this.index(u.state);
    // 等这次更新把公式画出来以后再标
    if (u.docChanged || u.viewportChanged || u.geometryChanged) requestAnimationFrame(() => this.mark(u.view));
  }
  index(state: EditorState) { this.starts = topBlocks(state).filter((b) => b.kind === "math").map((b) => b.from); }
  mark(view: EditorView) {
    view.dom.querySelectorAll<HTMLElement>(".hm-math-block").forEach((el) => {
      let pos: number;
      try { pos = view.posAtDOM(el); } catch { return; }
      // 找到起点不晚于 pos 的最后一个公式
      let lo = 0, hi = this.starts.length - 1, k = -1;
      while (lo <= hi) { const mid = (lo + hi) >> 1; if (this.starts[mid] <= pos + 1) { k = mid; lo = mid + 1; } else hi = mid - 1; }
      if (k >= 0) el.dataset.n = String(k + 1);
    });
  }
});

export function mathTools(): Extension {
  return [focused, mathTip, numbering];
}
