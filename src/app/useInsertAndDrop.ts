/**
 * 插入浮层（⌘⇧C / @）与系统文件拖放（从访达 / 资源管理器拖进正文）hook。
 */
import { useEffect, useRef, useState } from "react";
import type { EditorView } from "@codemirror/view";
import type { Backend } from "../lib/backend";
import type { Settings } from "../lib/settings";
import { blockInsertSpec } from "../editor/commands";
import { InsertPick, linkFor } from "../components/InsertFile";
import { dirOf, isInside, join } from "../lib/paths";
import type { SayFn } from "./appUtils";

const RECENT_KEY = "holymark-recent-insert";

export interface UseInsertAndDropArgs {
  be: Backend | null;
  root: string;
  path: string;
  s: Settings;
  view: () => EditorView | null;
  scroller: React.RefObject<HTMLDivElement>;
  insertAtCursor: (t: string, block?: boolean) => void;
  openExternalFile: (p: string, fromLink?: boolean) => Promise<void>;
  say: SayFn;
}

export function useInsertAndDrop({ be, root, path, s, view, scroller, insertAtCursor, openExternalFile, say }: UseInsertAndDropArgs) {
  /* ---------- 插入文件链接（⌘⇧C）：光标处的小浮层 ---------- */
  /** 插入浮层：位置；atPos 是在正文里打 @ 弹出时那个 @ 的位置（选中文献后把它换掉，G11） */
  const [insertAt, setInsertAt] = useState<{ left: number; top: number; bottom: number; q?: string; atPos?: number } | null>(null);
  const [recentIns, setRecentIns] = useState<string[]>(() => {
    try { return JSON.parse(localStorage.getItem(RECENT_KEY) || "[]"); } catch { return []; }
  });
  const rememberInsert = (p: string) => setRecentIns((r) => {
    const n = [p, ...r.filter((x) => x !== p)].slice(0, 12);
    try { localStorage.setItem(RECENT_KEY, JSON.stringify(n)); } catch { /* 存不了就算了 */ }
    return n;
  });

  function openInsert(q?: string, atPos?: number) {
    const v = view(); if (!v || !path) return;
    const init = typeof q === "string" ? q : undefined;
    const pos = typeof atPos === "number" ? atPos : undefined;
    const c = v.coordsAtPos(v.state.selection.main.head);
    const r = c ?? (() => { const b = v.contentDOM.getBoundingClientRect(); return { left: b.left, top: b.top + 40, bottom: b.top + 60 }; })();
    setInsertAt({ left: Math.round(r.left), top: Math.round(r.top), bottom: Math.round(r.bottom), q: init, atPos: pos });
  }

  function pickInsert(p: InsertPick) {
    const at = insertAt?.atPos;
    setInsertAt(null);
    if (p.kind === "bib") {
      // 正文里打 @（或 [@）弹出的：把那个 @ 换成 [@key]，避免出现 [[@key]
      const v = view();
      if (v && at !== undefined && v.state.sliceDoc(at, at + 1) === "@") {
        const hasOpen = at > 0 && v.state.sliceDoc(at - 1, at) === "[";
        const from = hasOpen ? at - 1 : at;
        let to = v.state.selection.main.head > at ? v.state.selection.main.head : at + 1;
        if (hasOpen && v.state.sliceDoc(to, to + 1) === "]") to += 1;
        const t = `[@${p.key}]`;
        v.dispatch({ changes: { from, to, insert: t }, selection: { anchor: from + t.length } });
        v.focus();
        return;
      }
      insertAtCursor(`[@${p.key}]`); return;
    }
    const l = linkFor(p.path, path);
    insertAtCursor(l.text, l.block);
    rememberInsert(p.path);
  }

  /** 引用文件夹以外的文件：用系统的文件选择窗口，插入相对路径链接 */
  async function citeOtherFile() {
    if (!be || !path) return;
    if (be.isDemo) { say("浏览器预览里不能选择本机文件"); return; }
    const f = await be.pickFile("选择要插入链接的文件");
    if (f) { const l = linkFor(f, path); insertAtCursor(l.text, l.block); }
  }

  /* ---------- 从访达 / 资源管理器拖文件进来 ---------- */
  const [dropCaret, setDropCaret] = useState<{ left: number; top: number; height: number } | null>(null);
  const overEditor = (x: number, y: number) => {
    const r = scroller.current?.getBoundingClientRect();
    return !!path && !!r && x >= r.left && x <= r.right && y >= r.top && y <= r.bottom;
  };

  /** 拖着移动时：正文里显示一条竖线，标出松手后插在哪里 */
  function dragOver(x: number, y: number) {
    const v = view();
    if (!v || !overEditor(x, y)) { setDropCaret(null); return; }
    const pos = v.posAtCoords({ x, y }) ?? v.state.selection.main.head;
    const c = v.coordsAtPos(pos);
    setDropCaret(c ? { left: Math.round(c.left), top: Math.round(c.top), height: Math.round(c.bottom - c.top) } : null);
  }

  /**
   * 松手：拖进正文的，图片插成插图（文件夹以外的先复制进本文旁边的 assets/），其他文件插成相对路径链接；
   * 拖到正文以外的地方，有 Markdown 文件就打开它。
   */
  async function dropFiles(paths: string[], x: number, y: number) {
    setDropCaret(null);
    const v = view();
    if (!be || !paths.length) return;
    if (!v || !overEditor(x, y)) {
      const md = paths.find((p) => /\.(md|markdown)$/i.test(p));
      if (md) await openExternalFile(md); else if (path) say("拖到正文里松手，就会插入文件链接");
      return;
    }
    const pos = v.posAtCoords({ x, y }) ?? v.state.selection.main.head;
    const imgs: string[] = [], links: string[] = [];
    let copied = 0;
    for (const p of paths) {
      if (/\.(png|jpe?g|gif|webp|svg|bmp)$/i.test(p)) {
        let src = p;
        if (!(root && isInside(root, p))) {
          try { src = await be.copyIntoFolder(p, join(dirOf(path), s.imageDir || "assets")); copied++; } catch (e) { say(`图片复制失败：${e}`, "error"); continue; }
        }
        imgs.push(linkFor(src, path).text);
      } else {
        // PDF、Word 这些单独成段（显示成预览卡片），其余插成行内链接
        const l = linkFor(p, path);
        (l.block ? imgs : links).push(l.text);
        rememberInsert(p);
      }
    }
    if (imgs.length) {
      const ins = blockInsertSpec(v.state.doc.toString(), pos, [...(links.length ? [links.join("　")] : []), ...imgs].join("\n\n"));
      v.dispatch({ changes: { from: ins.from, insert: ins.insert }, selection: { anchor: ins.cursor }, scrollIntoView: true });
    } else if (links.length) {
      const t = links.join("　");
      v.dispatch({ changes: { from: pos, insert: t }, selection: { anchor: pos + t.length }, scrollIntoView: true });
    }
    v.focus();
    const n = imgs.length + links.length;
    if (n) say(copied ? `已插入 ${n} 个文件，其中 ${copied} 张图片复制到了 ${s.imageDir || "assets"}/` : imgs.length && !links.length ? `已插入 ${imgs.length} 张图片` : `已插入 ${n} 个文件链接`, "success");
  }

  const dropRef = useRef({ dragOver, dropFiles });
  dropRef.current = { dragOver, dropFiles };
  useEffect(() => {
    if (!be) return;
    let frame = 0;
    return be.onFileDrop((e) => {
      cancelAnimationFrame(frame);
      if (e.type === "over") frame = requestAnimationFrame(() => dropRef.current.dragOver(e.x, e.y));
      else if (e.type === "drop") dropRef.current.dropFiles(e.paths, e.x, e.y);
      else setDropCaret(null);
    });
  }, [be]);

  return { insertAt, setInsertAt, recentIns, openInsert, pickInsert, citeOtherFile, dropCaret };
}
