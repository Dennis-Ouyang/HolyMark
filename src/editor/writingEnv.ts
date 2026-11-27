/**
 * N13 书写环境（编辑器这一侧）：
 * - 打字机滚动：打字（输入、删除）时把光标所在行保持在屏幕高度的 45% 左右；鼠标滚动、点击不受影响；
 *   直接到位、不做动画（所以不受「减弱动态效果」影响）。
 * - 段落聚焦：光标所在的段落（前后空行之间）正常显示，其余降到约 35% 不透明度（CSS 控制，这里只标出当前段落）。
 */
import { EditorState, Extension, Range } from "@codemirror/state";
import { Decoration, DecorationSet, EditorView, ViewPlugin, ViewUpdate } from "@codemirror/view";

export interface EnvHooks { typewriter: () => boolean; paraFocus: () => boolean }

function typewriter(on: () => boolean) {
  let frame = 0;
  return EditorView.updateListener.of((u) => {
    if (!on() || !u.docChanged || !u.transactions.some((t) => t.isUserEvent("input") || t.isUserEvent("delete"))) return;
    const view = u.view;
    // 等 CodeMirror 自己「把光标滚进视野」做完再滚，否则两边互相打断
    cancelAnimationFrame(frame);
    frame = requestAnimationFrame(() => {
      const sc = view.dom.closest(".scroller") as HTMLElement | null;
      const c = view.coordsAtPos(view.state.selection.main.head);
      if (!sc || !c) return;
      const r = sc.getBoundingClientRect();
      const diff = c.top - (r.top + sc.clientHeight * 0.45);
      if (Math.abs(diff) < 4) return;
      // 直接到位，不做平滑滚动：打字时每行都在动，平滑滚动会和编辑器自己的滚动校正互相打断，
      // 也省掉了「减弱动态效果」的判断（没有动画）
      sc.scrollTop = Math.round(sc.scrollTop + diff);
    });
  });
}

/** 光标所在段落：往上、往下各找到空行为止 */
export function paragraphLines(state: EditorState): [number, number] {
  const doc = state.doc;
  const cur = doc.lineAt(state.selection.main.head).number;
  let a = cur, z = cur;
  if (!doc.line(cur).text.trim()) return [cur, cur];
  while (a > 1 && doc.line(a - 1).text.trim()) a--;
  while (z < doc.lines && doc.line(z + 1).text.trim()) z++;
  return [a, z];
}

const curLine = Decoration.line({ class: "hm-pf-cur" });
function paraFocus(on: () => boolean) {
  return ViewPlugin.fromClass(class {
    decorations: DecorationSet = Decoration.none;
    key = "";
    constructor(view: EditorView) { this.calc(view); }
    update(u: ViewUpdate) { if (u.docChanged || u.selectionSet || u.focusChanged || u.transactions.length) this.calc(u.view); }
    calc(view: EditorView) {
      if (!on()) { if (this.key) { this.key = ""; this.decorations = Decoration.none; } return; }
      const [a, z] = paragraphLines(view.state);
      const key = `${a}-${z}-${view.state.doc.length}`;
      if (key === this.key) return;
      this.key = key;
      const out: Range<Decoration>[] = [];
      for (let n = a; n <= z; n++) out.push(curLine.range(view.state.doc.line(n).from));
      this.decorations = Decoration.set(out);
    }
  }, { decorations: (p) => p.decorations });
}

export function writingEnv(hooks: () => EnvHooks | undefined): Extension {
  return [typewriter(() => hooks()?.typewriter() ?? false), paraFocus(() => hooks()?.paraFocus() ?? false)];
}
