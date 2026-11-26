/** N12 公式符号面板的接线：公式预览浮层上的按钮、⌘K 命令都走 open()。 */
import { useCallback, useEffect, useState } from "react";
import type { EditorView } from "@codemirror/view";
import { Presence } from "../components/Presence";
import { SymbolPanel } from "../components/SymbolPanel";

const W = 380;

export function useSymbols(view: () => EditorView | null) {
  const [at, setAt] = useState<{ left: number; top: number; origin: string } | null>(null);
  /** 从某个按钮（或光标处）长出来，下面放不下就翻到上面 */
  const open = useCallback((anchor?: DOMRect) => {
    const v = view(); if (!v) return;
    // 浮层刚建、还没量好位置时（CodeMirror 先放在屏幕外），按光标位置算
    if (anchor && (anchor.bottom <= 0 || anchor.top >= innerHeight)) anchor = undefined;
    const r = anchor ?? (() => { const c = v.coordsAtPos(v.state.selection.main.head); return c ? new DOMRect(c.left, c.top, 1, c.bottom - c.top) : v.contentDOM.getBoundingClientRect(); })();
    const left = Math.round(Math.max(12, Math.min(r.left - 12, innerWidth - W - 12)));
    const below = r.bottom + 260 < innerHeight;
    const top = Math.round(Math.max(8, Math.min(innerHeight - 270, below ? r.bottom + 6 : r.top - 6 - 250)));
    setAt({ left, top, origin: `${Math.round(r.left - left + 6)}px ${below ? "0" : "100%"}` });
  }, [view]);
  const close = useCallback(() => { setAt(null); view()?.focus(); }, [view]);
  useEffect(() => {
    const f = (e: Event) => open((e as CustomEvent<DOMRect>).detail);
    addEventListener("hm-symbols", f);
    return () => removeEventListener("hm-symbols", f);
  }, [open]);
  const v = view();
  const node = <Presence ms={110}>{at && v && <SymbolPanel view={v} at={at} onClose={close} />}</Presence>;
  return { open, node };
}
