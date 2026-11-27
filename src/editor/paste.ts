/**
 * 粘贴的统一入口（G9）：按剪贴板里的内容类型分发给不同的处理器，按优先级从高到低试，第一个接手的处理。
 * 内置三个：图片（交给应用存进 assets/）、带格式的内容（网页、Word 的 HTML 转成 Markdown）、纯文本（交给编辑器默认处理）。
 * 以后加 Excel 表格粘贴：registerPasteHandler({ name: "excel-table", priority: 30, ... })。
 * 代码块里一律按纯文本粘贴。
 */
import type { Extension } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { inCodeBlock } from "./keys";
import { htmlToMarkdown } from "../lib/htmlToMarkdown";

export interface PasteHandler {
  name: string;
  /** 越大越先试 */
  priority: number;
  /** 能不能处理这份剪贴板内容 */
  accepts(data: DataTransfer, view: EditorView): boolean;
  /** 处理；返回 false 表示放弃，交给下一个 */
  handle(data: DataTransfer, view: EditorView): boolean;
}

const handlers: PasteHandler[] = [];
export function registerPasteHandler(h: PasteHandler) {
  const i = handlers.findIndex((x) => x.name === h.name);
  if (i >= 0) handlers.splice(i, 1);
  handlers.push(h);
  handlers.sort((a, b) => b.priority - a.priority);
  return () => { const k = handlers.indexOf(h); if (k >= 0) handlers.splice(k, 1); };
}

/** 带格式的内容：有 text/html，而且不只是包了一层的纯文本（有标题、列表、加粗、链接、表格之类） */
const RICH = /<(h[1-6]|ul|ol|li|table|strong|b|em|i|a\s|blockquote|pre|code|del|s)\b/i;
registerPasteHandler({
  name: "rich-text",
  priority: 20,
  accepts: (d) => RICH.test(d.getData("text/html") || ""),
  handle(d, view) {
    const md = htmlToMarkdown(d.getData("text/html"));
    if (!md.trim()) return false;
    view.dispatch(view.state.replaceSelection(md), { userEvent: "input.paste", scrollIntoView: true });
    return true;
  },
});

export function paste(onImages: (files: File[], pos: number) => void): Extension {
  return EditorView.domEventHandlers({
    paste(e, view) {
      const d = e.clipboardData;
      if (!d) return false;
      if (inCodeBlock(view.state, view.state.selection.main.head)) return false; // 代码块里按纯文本
      const files = [...(d.files || [])].filter((f) => f.type.startsWith("image/"));
      if (files.length) { e.preventDefault(); onImages(files, view.state.selection.main.head); return true; }
      for (const h of handlers) {
        if (!h.accepts(d, view)) continue;
        if (h.handle(d, view)) { e.preventDefault(); return true; }
      }
      return false; // 纯文本：编辑器默认处理
    },
  });
}
