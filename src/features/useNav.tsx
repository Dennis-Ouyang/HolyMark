/**
 * N4 跳转历史：点目录、搜索结果、文内链接、文件卡片之前先记下现在的位置（文件 + 位置），可以返回、前进。
 * 快捷键：macOS ⌃⌘← / ⌃⌘→，Windows 和浏览器预览 Alt+← / Alt+→（⌘[ ⌘] 已经给了列表缩进）。
 * 有历史时，标题栏路径左边出现两个小箭头，没有就不显示。
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { EditorView } from "@codemirror/view";
import { emptyNav, goBack, goForward, leave, Loc, Nav, renameNav } from "../lib/navHistory";
import { isMac } from "../lib/platform";
import { Icon } from "../components/Icons";
import { kbd } from "../lib/platform";

interface Ctx {
  view: () => EditorView | null;
  livePath: () => string;
  /** 打开另一篇（有明确目标，不恢复上次位置） */
  open: (path: string) => Promise<void>;
}

export const BACK_KEY = isMac ? "⌃⌘←" : "Alt+←";
export const FWD_KEY = isMac ? "⌃⌘→" : "Alt+→";

export function useNav(ctx: Ctx) {
  const [nav, setNav] = useState<Nav>(emptyNav);
  const navRef = useRef(nav);
  navRef.current = nav;
  const c = useRef(ctx);
  c.current = ctx;
  const here = (): Loc => ({ path: c.current.livePath(), pos: c.current.view()?.state.selection.main.head ?? 0 });

  /** 要跳到别处之前调用 */
  const record = useCallback(() => { const cur = here(); if (cur.path) setNav((n) => leave(n, cur)); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const goTo = async (to: Loc) => {
    if (to.path !== c.current.livePath()) await c.current.open(to.path);
    requestAnimationFrame(() => {
      const v = c.current.view(); if (!v) return;
      const pos = Math.min(to.pos, v.state.doc.length);
      v.dispatch({ selection: { anchor: pos }, effects: EditorView.scrollIntoView(pos, { y: "center" }) });
      v.focus();
    });
  };
  const back = useCallback(() => { const r = goBack(navRef.current, here()); if (r) { setNav(r.nav); void goTo(r.to); } }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const forward = useCallback(() => { const r = goForward(navRef.current, here()); if (r) { setNav(r.nav); void goTo(r.to); } }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const rename = useCallback((from: string, to: string | null) => setNav((n) => renameNav(n, from, to)), []);

  useEffect(() => {
    // 捕获阶段处理：编辑器里 Alt+← 本来是按语法单元移动光标，这里优先当返回
    const f = (e: KeyboardEvent) => {
      if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
      const hit = isMac ? e.metaKey && e.ctrlKey && !e.altKey && !e.shiftKey : e.altKey && !e.ctrlKey && !e.metaKey && !e.shiftKey;
      if (!hit) return;
      const ae = document.activeElement as HTMLElement | null;
      if (ae && (ae.tagName === "INPUT" || ae.tagName === "TEXTAREA")) return;
      const n = navRef.current;
      if (e.key === "ArrowLeft" ? !n.back.length : !n.fwd.length) return;
      e.preventDefault(); e.stopPropagation();
      if (e.key === "ArrowLeft") back(); else forward();
    };
    addEventListener("keydown", f, true);
    return () => removeEventListener("keydown", f, true);
  }, [back, forward]);

  const has = nav.back.length > 0 || nav.fwd.length > 0;
  const arrows = has ? (
    <span className="navarrows">
      <button className="ib sm" disabled={!nav.back.length} title={kbd(`返回 ${BACK_KEY}`)} aria-label="返回" onClick={back}><Icon name="left" size={14} /></button>
      <button className="ib sm" disabled={!nav.fwd.length} title={kbd(`前进 ${FWD_KEY}`)} aria-label="前进" onClick={forward}><Icon name="right" size={14} /></button>
    </span>
  ) : null;
  return { record, back, forward, rename, arrows, canBack: nav.back.length > 0, canForward: nav.fwd.length > 0 };
}
