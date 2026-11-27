/**
 * N3 记住每一篇读到、写到哪里的接线：
 * - 切换文件、关窗口时记一次，平时每 15 秒有变化也记一次；
 * - 重新打开时恢复光标、屏幕最上方那一段、折叠、阅读模式；
 * - 从搜索结果、文内链接这类有明确目标的方式打开时，以目标为准，不恢复（调用方传 target）。
 */
import { useCallback, useEffect, useRef } from "react";
import { EditorView } from "@codemirror/view";
import { clampSpot, loadSpots, rememberSpot, renameSpots, saveSpots, Spot, SpotStore } from "../lib/positions";
import { foldedHeadingLines, restoreFolds } from "../editor/sectionFold";
import { isReading } from "../editor/readingMode";

export function useRememberSpot(view: () => EditorView | null, scroller: () => HTMLElement | null) {
  const store = useRef<SpotStore>(loadSpots());
  const last = useRef("");

  /** 现在这一篇的位置 */
  const capture = useCallback((path: string) => {
    const v = view(), sc = scroller();
    if (!v || !path) return;
    const sel = v.state.selection.main;
    let top = 0;
    if (sc) {
      const h = sc.getBoundingClientRect().top - v.documentTop;
      top = h > 0 ? v.lineBlockAtHeight(h).from : 0;
    }
    const spot: Spot = { anchor: sel.anchor, head: sel.head, top, folds: foldedHeadingLines(v.state), reading: isReading(v.state), at: Date.now() };
    const key = JSON.stringify({ ...spot, at: 0 });
    if (key === last.current && store.current[path]) return;
    last.current = key;
    store.current = rememberSpot(store.current, path, spot);
    saveSpots(store.current);
  }, [view, scroller]);

  const recall = useCallback((path: string): Spot | null => store.current[path] ?? null, []);

  /** 打开以后：折叠先恢复（会影响高度），再放光标，最后把记下的那一段滚到最上方 */
  const restore = useCallback((spot: Spot) => {
    const v = view(); if (!v) return;
    const s = clampSpot(spot, v.state.doc.length, v.state.doc.lines);
    restoreFolds(v, s.folds);
    v.dispatch({ selection: { anchor: s.anchor, head: s.head } });
    requestAnimationFrame(() => {
      const w = view(); if (!w) return;
      w.dispatch({ effects: EditorView.scrollIntoView(Math.min(s.top, w.state.doc.length), { y: "start", yMargin: 0 }) });
    });
    last.current = "";
  }, [view]);

  const move = useCallback((from: string, to: string) => { store.current = renameSpots(store.current, from, to); saveSpots(store.current); }, []);
  return { capture, recall, restore, move };
}

/** 平时每 15 秒记一次（只有变了才真的写），关窗口前也记一次 */
export function useSpotAutosave(capture: (path: string) => void, path: () => string) {
  useEffect(() => {
    const id = window.setInterval(() => capture(path()), 15_000);
    const f = () => capture(path());
    addEventListener("beforeunload", f);
    addEventListener("pagehide", f);
    return () => { window.clearInterval(id); removeEventListener("beforeunload", f); removeEventListener("pagehide", f); };
  }, [capture, path]);
}
