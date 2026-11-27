/**
 * N11 粘贴成表格：剪贴板里是 Excel、WPS 表格（HTML 表格或制表符分隔的文字）时，粘贴成 Markdown 表格。
 * 接在 G9 的粘贴入口上（paste.ts 的 registerPasteHandler，优先级 30：比普通的带格式粘贴先试，也比图片先试——
 * Excel 复制时会顺带放一张单元格的截图）。粘贴后提示条「已粘贴为表格」带「改为纯文本」，一键退回原样文字。
 * 转换是纯函数（lib/pasteTable.ts）。
 */
import { EditorView } from "@codemirror/view";
import { registerPasteHandler } from "./paste";
import { pasteTable } from "../lib/pasteTable";
import { notify } from "./notice";

registerPasteHandler({
  name: "excel-table",
  priority: 30,
  accepts: (d) => /<table[\s>]/i.test(d.getData("text/html") || "") || (d.getData("text/plain") || "").includes("\t"),
  handle(d, view) {
    const plain = d.getData("text/plain") || "";
    const md = pasteTable(d.getData("text/html") || "", plain);
    if (!md) return false;
    insertTable(view, md, plain);
    return true;
  },
});

/** 表格单独成块：前后补够空行 */
export function insertTable(view: EditorView, md: string, plain: string) {
  const st = view.state;
  const { from, to } = st.selection.main;
  const line = st.doc.lineAt(from), lineEnd = st.doc.lineAt(to);
  const beforeText = st.sliceDoc(line.from, from), afterText = st.sliceDoc(to, lineEnd.to);
  const prevBlank = line.number === 1 || !st.doc.line(line.number - 1).text.trim();
  const pre = beforeText.trim() ? "\n\n" : prevBlank ? "" : "\n";
  const post = afterText.trim() ? "\n\n" : lineEnd.number < st.doc.lines && !st.doc.line(lineEnd.number + 1).text.trim() ? "" : "\n";
  const insert = pre + md + post;
  view.dispatch({ changes: { from, to, insert }, selection: { anchor: from + insert.length }, userEvent: "input.paste", scrollIntoView: true });
  const at = from;
  notify("已粘贴为表格", "success", {
    label: "改为纯文本",
    run: () => {
      // 只在表格还原样在那里时退回（之后又改过就不动，免得盖掉新写的字）
      if (view.state.sliceDoc(at, at + insert.length) !== insert) return;
      view.dispatch({ changes: { from: at, to: at + insert.length, insert: plain.replace(/\r\n?/g, "\n") }, userEvent: "input.paste" });
      view.focus();
    },
  });
}
