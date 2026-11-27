/**
 * N2 阅读模式（编辑器这一侧）：
 * - 整篇只显示排好版的样子：不可编辑、光标进不去，点哪里都不切成源码（livePreview 里看 readingField）；
 * - 可以选中文字复制；
 * - 链接单击就打开，图片点开放大（交给 hooks，由界面处理）；
 * - 待办的勾选框照样能点（那是操作控件，不是改文字）；
 * - 文献引用、脚注悬停显示内容：和编辑时用同一套浮层（livePreview 的 CiteWidget、footnotes.ts），这里不另做；
 * - 双击正文：退出阅读模式，光标放在双击的位置。
 */
import { EditorState, Extension, StateEffect, StateField } from "@codemirror/state";
import { EditorView, ViewPlugin } from "@codemirror/view";
import { ensureSyntaxTree, syntaxTree } from "@codemirror/language";
import { linkAt } from "./links";


export const setReading = StateEffect.define<boolean>();
export const readingField = StateField.define<boolean>({
  create: () => false,
  update: (v, tr) => { for (const e of tr.effects) if (e.is(setReading)) return e.value; return v; },
  provide: (f) => [
    EditorView.editable.from(f, (r) => !r),
    EditorState.readOnly.from(f, (r) => r),
    EditorView.editorAttributes.from(f, (r): Record<string, string> => (r ? { class: "hm-reading" } : {})),
  ],
});
export const isReading = (s: EditorState) => s.field(readingField, false) ?? false;

export interface DocImage { from: number; to: number; src: string; alt: string }
/** 全文的图片（代码里的不算），按出现顺序 */
export function docImages(state: EditorState): DocImage[] {
  const tree = ensureSyntaxTree(state, state.doc.length, 1000) ?? syntaxTree(state);
  const out: DocImage[] = [];
  tree.iterate({
    enter: (n) => {
      if (n.name === "FencedCode" || n.name === "CodeBlock" || n.name === "InlineCode") return false;
      if (n.name !== "Image") return;
      const t = state.sliceDoc(n.from, n.to);
      const m = t.match(/^!\[([^\]]*)\]\(\s*(<[^>]*>|[^)\s]+)/);
      if (m) out.push({ from: n.from, to: n.to, alt: m[1], src: m[2].replace(/^<|>$/g, "") });
      return false;
    },
  });
  return out;
}

export interface ReadingHooks {
  openImage: (view: EditorView, index: number, images: DocImage[], rect: DOMRect) => void;
  openLink: (href: string) => void;
  /** 双击正文：退出阅读模式，光标放在 pos */
  exitAt: (pos: number) => void;
}

function clickHandlers(hooks: () => ReadingHooks | undefined) {
  return ViewPlugin.fromClass(class {
    constructor(readonly view: EditorView) {
      view.dom.addEventListener("mousedown", this.down, true);
      view.dom.addEventListener("click", this.click, true);
      view.dom.addEventListener("dblclick", this.dbl, true);
      view.dom.addEventListener("focusin", this.focusin, true);
    }
    destroy() {
      this.view.dom.removeEventListener("mousedown", this.down, true);
      this.view.dom.removeEventListener("click", this.click, true);
      this.view.dom.removeEventListener("dblclick", this.dbl, true);
      this.view.dom.removeEventListener("focusin", this.focusin, true);
    }
    down = (e: MouseEvent) => {
      if (!isReading(this.view.state) || e.button !== 0) return;
      const t = e.target as HTMLElement;
      if (t.closest(".hm-check, .hm-sfold, .hm-lfold, .hm-folded")) return; // 待办勾选框、折叠照常
      const img = t.closest<HTMLImageElement>(".hm-figure img, .hm-img-inline img");
      if (img) {
        e.preventDefault(); e.stopPropagation();
        const images = docImages(this.view.state);
        let pos = 0;
        try { pos = this.view.posAtDOM(img); } catch { /* 找不到就从第一张开始 */ }
        let i = images.findIndex((x) => x.to >= pos);
        if (i < 0) i = images.length - 1;
        hooks()?.openImage(this.view, Math.max(0, i), images, img.getBoundingClientRect());
        return;
      }
      // 图片工具条、批注小图标、表格单元格、文件卡片的编辑：阅读模式里都不响应（表格单元格本身可编辑，也不让它拿到焦点）
      if (t.closest(".hm-notedot, .hm-table td, .hm-table th, .hm-itools, .hm-igrip, .hm-ttools, .hm-colgrip")) { e.preventDefault(); e.stopPropagation(); }
    };
    click = (e: MouseEvent) => {
      // 编辑时的 ⌘ / Ctrl + 点击在 links.ts 里处理；这里只管阅读模式的单击
      if (!isReading(this.view.state) || e.button !== 0 || e.detail > 1) return;
      const t = e.target as HTMLElement;
      const el = t.closest<HTMLElement>(".hm-link, .cm-content a");
      if (!el) return;
      // 拖着选了文字的不算点链接
      if (!this.view.state.selection.main.empty || (getSelection()?.toString() ?? "")) return;
      // 用链接元素自己的位置（折行的链接按坐标会落到别处）
      let pos: number | null = null;
      try { pos = this.view.posAtDOM(el) + 1; } catch { pos = this.view.posAtCoords({ x: e.clientX, y: e.clientY }); }
      if (pos === null) return;
      const l = linkAt(this.view.state, pos);
      if (!l) return;
      e.preventDefault(); e.stopPropagation();
      hooks()?.openLink(l.href);
    };
    dbl = (e: MouseEvent) => {
      if (!isReading(this.view.state)) return;
      if ((e.target as HTMLElement).closest(".hm-check, .hm-sfold, .hm-lfold, .hm-folded")) return;
      const pos = this.view.posAtCoords({ x: e.clientX, y: e.clientY });
      e.preventDefault(); e.stopPropagation();
      hooks()?.exitAt(pos ?? this.view.state.selection.main.head);
    };
    focusin = (e: FocusEvent) => {
      if (isReading(this.view.state) && (e.target as HTMLElement).isContentEditable && e.target !== this.view.contentDOM) (e.target as HTMLElement).blur();
    };
  });
}

export function readingMode(hooks: () => ReadingHooks | undefined): Extension {
  return [readingField, clickHandlers(hooks)];
}
