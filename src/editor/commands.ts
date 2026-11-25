/** 格式命令：都只是在源码里加减 Markdown 符号。工具栏、功能区、快捷键共用。 */
import { EditorSelection } from "@codemirror/state";
import type { EditorView } from "@codemirror/view";

export type InlineKind = "bold" | "italic" | "strike" | "code" | "math";
const MARK: Record<InlineKind, string> = { bold: "**", italic: "*", strike: "~~", code: "`", math: "$" };

/** 加上或去掉行内符号。选区两侧已有同样符号时去掉。完成后光标放在这段文字末尾；没选中文字时光标停在两个符号中间。 */
export function toggleInline(view: EditorView, kind: InlineKind) {
  const mk = MARK[kind];
  const { state } = view;
  view.dispatch(state.changeByRange((r) => {
    if (r.empty) {
      return { changes: { from: r.from, insert: mk + mk }, range: EditorSelection.cursor(r.from + mk.length) };
    }
    const before = state.sliceDoc(r.from - mk.length, r.from);
    const after = state.sliceDoc(r.to, r.to + mk.length);
    const isBoldStar = mk === "*" && state.sliceDoc(r.from - 2, r.from) === "**" && state.sliceDoc(r.from - 3, r.from) !== "***";
    if (before === mk && after === mk && !isBoldStar) {
      return { changes: [{ from: r.from - mk.length, to: r.from }, { from: r.to, to: r.to + mk.length }], range: EditorSelection.cursor(r.to - mk.length) };
    }
    const inner = state.sliceDoc(r.from, r.to);
    if (inner.length >= 2 * mk.length && inner.startsWith(mk) && inner.endsWith(mk)) {
      return { changes: { from: r.from, to: r.to, insert: inner.slice(mk.length, -mk.length) }, range: EditorSelection.cursor(r.to - 2 * mk.length) };
    }
    return { changes: [{ from: r.from, insert: mk }, { from: r.to, insert: mk }], range: EditorSelection.cursor(r.to + 2 * mk.length) };
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
