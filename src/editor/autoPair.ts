/**
 * 输入时自动补全 Markdown 符号：
 * - 打出 ** 或 ~~ 时自动补上后面一对，光标停在中间；
 * - 光标后面正好是自动补出来的符号时，再输入同样的符号直接跳过去；
 * - 在空的 **|** 中间按退格，两边一起删；
 * - 在一行开头输入 ``` 或 $$ 后按回车，自动补上结尾的 ``` 或 $$。
 */
import { EditorSelection, Extension } from "@codemirror/state";
import { EditorView, keymap } from "@codemirror/view";
import { syntaxTree } from "@codemirror/language";

const PAIRS = ["**", "~~"];

function inCode(view: EditorView, pos: number) {
  for (let n: { name: string; parent: unknown } | null = syntaxTree(view.state).resolveInner(pos, -1); n; n = n.parent as typeof n) {
    if (n.name === "InlineCode" || n.name === "FencedCode" || n.name === "CodeBlock") return true;
  }
  return false;
}

const typeHandler = EditorView.inputHandler.of((view, from, to, text) => {
  if (text.length !== 1 || from !== to || view.composing) return false;
  const { state } = view;
  const before = state.sliceDoc(from - 1, from);
  const after2 = state.sliceDoc(from, from + 2);
  if (inCode(view, from)) return false;
  for (const p of PAIRS) {
    const ch = p[0];
    if (text !== ch) continue;
    // 跳过已经补好的结尾符号：逐个字符跳，打完两个正好越过结尾
    const next = state.sliceDoc(from, from + 1);
    const closingFirst = after2 === p && before !== ch;
    const closingSecond = before === ch && next === ch && state.sliceDoc(from - 2, from - 1) !== ch && state.sliceDoc(from - 2, from - 1) !== "";
    if (closingFirst || closingSecond) {
      view.dispatch({ selection: { anchor: from + 1 } });
      return true;
    }
    // 第二个符号：补上结尾一对
    if (before === ch && state.sliceDoc(from - 2, from - 1) !== ch && state.sliceDoc(from, from + 1) !== ch) {
      view.dispatch({ changes: { from, insert: ch + p }, selection: { anchor: from + 1 }, userEvent: "input.type" });
      return true;
    }
  }
  return false;
});

function deletePair(view: EditorView) {
  const { state } = view;
  const r = state.selection.main;
  if (!r.empty) return false;
  for (const p of PAIRS) {
    if (state.sliceDoc(r.from - p.length, r.from) === p && state.sliceDoc(r.from, r.from + p.length) === p) {
      view.dispatch({ changes: { from: r.from - p.length, to: r.from + p.length }, userEvent: "delete.backward" });
      return true;
    }
  }
  return false;
}

/** ``` 或 $$ 后按回车：补上结尾 */
function closeFence(view: EditorView) {
  const { state } = view;
  const r = state.selection.main;
  if (!r.empty) return false;
  const line = state.doc.lineAt(r.head);
  if (r.head !== line.to) return false;
  const m = line.text.match(/^(\s*)(```+|~~~+|\$\$)([\w+-]*)\s*$/);
  if (!m) return false;
  const fence = m[2];
  // 如果后面已经有配对的结尾（这一行本身是结尾），就不补
  let open = 0;
  for (let n = 1; n < line.number; n++) {
    const t = state.doc.line(n).text.trim();
    if (fence === "$$" ? t === "$$" : t.startsWith(fence.slice(0, 3))) open++;
  }
  if (open % 2 === 1) return false;
  const insert = "\n" + m[1] + "\n" + m[1] + fence;
  view.dispatch({ changes: { from: r.head, insert }, selection: EditorSelection.cursor(r.head + 1 + m[1].length), scrollIntoView: true, userEvent: "input" });
  return true;
}

export function autoPair(): Extension {
  return [typeHandler, keymap.of([{ key: "Backspace", run: deletePair }, { key: "Enter", run: closeFence }])];
}
