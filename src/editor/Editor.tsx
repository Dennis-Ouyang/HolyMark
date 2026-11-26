import { forwardRef, useEffect, useImperativeHandle, useRef } from "react";
import { Compartment, EditorState, Extension } from "@codemirror/state";
import { EditorView, keymap, drawSelection, highlightActiveLine } from "@codemirror/view";
import { defaultKeymap, history, historyKeymap, indentWithTab, undo, redo } from "@codemirror/commands";
import { markdown, markdownLanguage } from "@codemirror/lang-markdown";
import { languages } from "@codemirror/language-data";
import { syntaxHighlighting, HighlightStyle } from "@codemirror/language";
import { searchKeymap, openSearchPanel } from "@codemirror/search";
import { tags as t } from "@lezer/highlight";
import { flash, livePreview, PreviewOptions } from "./livePreview";
import { continueList, indentList, toggleInline } from "./commands";
import { autoPair } from "./autoPair";
import { cjkEmphasis, highlight } from "./cjkEmphasis";
import { Subscript, Superscript } from "@lezer/markdown";

export interface EditorHandle {
  view: () => EditorView | null;
  /** 换成另一个文件的内容（不进撤销历史） */
  load: (text: string) => void;
  /** 外部修改后替换内容，保留光标大致位置 */
  replace: (text: string) => void;
  flash: (lines: number[]) => void;
  undo: () => void;
  redo: () => void;
  find: () => void;
}

interface Props {
  initial: string;
  preview: PreviewOptions;
  previewKey: string;
  onChange: (text: string) => void;
  onSelection: (view: EditorView) => void;
  /** 粘贴或拖进来的图片文件，pos 是要插入的位置 */
  onImages: (files: File[], pos: number) => void;
}

/** 代码块里的语法高亮颜色走主题变量 */
const codeHighlight = HighlightStyle.define([
  { tag: [t.keyword, t.controlKeyword, t.operatorKeyword, t.definitionKeyword], color: "var(--hl-kw)" },
  { tag: [t.string, t.special(t.string)], color: "var(--hl-str)" },
  { tag: [t.number, t.bool, t.null], color: "var(--hl-num)" },
  { tag: [t.comment, t.lineComment, t.blockComment], color: "var(--hl-com)", fontStyle: "italic" },
  { tag: [t.function(t.variableName), t.function(t.propertyName)], color: "var(--hl-fn)" },
]);

export const Editor = forwardRef<EditorHandle, Props>(function Editor({ initial, preview, previewKey, onChange, onSelection, onImages }, ref) {
  const host = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  const previewCompartment = useRef(new Compartment());
  const cb = useRef({ onChange, onSelection, onImages });
  cb.current = { onChange, onSelection, onImages };
  const silent = useRef(false);
  const exts = useRef<Extension[]>([]);
  const previewRef = useRef(preview);
  previewRef.current = preview;

  useEffect(() => {
    exts.current = [
          history(),
          drawSelection(),
          highlightActiveLine(),
          EditorView.lineWrapping,
          markdown({ base: markdownLanguage, codeLanguages: languages, extensions: [cjkEmphasis, highlight, Superscript, Subscript] }),
          syntaxHighlighting(codeHighlight),
          previewCompartment.current.of(livePreview(preview)),
          autoPair(),
          keymap.of([
            { key: "Enter", run: continueList },
            { key: "Tab", run: (v) => indentList(v, 1) },
            { key: "Shift-Tab", run: (v) => indentList(v, -1) },
            { key: "Mod-b", run: (v) => (toggleInline(v, "bold"), true) },
            { key: "Mod-i", run: (v) => (toggleInline(v, "italic"), true) },
            { key: "Mod-e", run: (v) => (toggleInline(v, "code"), true) },
            ...searchKeymap,
            ...historyKeymap,
            ...defaultKeymap,
            indentWithTab,
          ]),
          EditorView.updateListener.of((u) => {
            if (u.docChanged && !silent.current) cb.current.onChange(u.state.doc.toString());
            if (u.selectionSet || u.docChanged || u.focusChanged) cb.current.onSelection(u.view);
          }),
          EditorView.domEventHandlers({
            paste(e, v) {
              const files = [...(e.clipboardData?.files || [])].filter((f) => f.type.startsWith("image/"));
              if (!files.length) return false;
              e.preventDefault();
              cb.current.onImages(files, v.state.selection.main.head);
              return true;
            },
            drop(e, v) {
              const all = [...(e.dataTransfer?.files || [])];
              if (!all.length) return false;
              // 应用里由系统级拖放处理（拿得到完整路径），这里只拦下来，免得插两遍
              if ("__TAURI_INTERNALS__" in window) { e.preventDefault(); return true; }
              const files = all.filter((f) => f.type.startsWith("image/"));
              if (!files.length) return false;
              e.preventDefault();
              const pos = v.posAtCoords({ x: e.clientX, y: e.clientY }) ?? v.state.selection.main.head;
              cb.current.onImages(files, pos);
              return true;
            },
          }),
          EditorView.contentAttributes.of({ spellcheck: "false", "aria-label": "正文" }),
        ];
    const view = new EditorView({ parent: host.current!, state: EditorState.create({ doc: initial, extensions: exts.current }) });
    viewRef.current = view;
    return () => view.destroy();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 语法显示方式、文献库变化时重建装饰
  useEffect(() => {
    viewRef.current?.dispatch({ effects: previewCompartment.current.reconfigure(livePreview(preview)) });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [previewKey]);

  useImperativeHandle(ref, () => ({
    view: () => viewRef.current,
    load(text) {
      const v = viewRef.current!;
      v.setState(EditorState.create({ doc: text, extensions: exts.current }));
      v.dispatch({ effects: previewCompartment.current.reconfigure(livePreview(previewRef.current)) });
      v.scrollDOM.scrollTop = 0;
    },
    replace(text) {
      const v = viewRef.current!;
      const head = Math.min(v.state.selection.main.head, text.length);
      silent.current = true;
      v.dispatch({ changes: { from: 0, to: v.state.doc.length, insert: text }, selection: { anchor: head } });
      silent.current = false;
    },
    flash(lines) { if (viewRef.current && lines.length) flash(viewRef.current, lines); },
    undo() { const v = viewRef.current; if (v) { undo(v); v.focus(); } },
    redo() { const v = viewRef.current; if (v) { redo(v); v.focus(); } },
    find() { const v = viewRef.current; if (v) { v.focus(); openSearchPanel(v); } },
  }));

  return <div className="hm-editor" ref={host} />;
});
