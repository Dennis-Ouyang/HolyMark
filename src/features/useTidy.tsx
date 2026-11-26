/** 中文排版整理的接线：打开浮层、执行、撤销。App 里只调用这个 hook，渲染它返回的 node。 */
import { useCallback, useState } from "react";
import { ChangeSet } from "@codemirror/state";
import type { EditorView } from "@codemirror/view";
import { Presence } from "../components/Presence";
import { TidyPanel } from "../components/TidyPanel";
import type { TidyResult, TidyRules } from "../lib/tidy";

interface Ctx {
  view: () => EditorView | null;
  rules: TidyRules;
  text: string;
  say: (m: string, action?: { label: string; run: () => void }) => void;
  openSettings: () => void;
}

export function useTidy({ view, rules, text, say, openSettings }: Ctx) {
  const [at, setAt] = useState<{ left: number; top: number; origin: string } | null>(null);

  /** 从功能区按钮打开时贴着按钮长出来；从 ⌘K 打开时放在正文区右上角 */
  const open = useCallback((anchor?: HTMLElement | null) => {
    const v = view(); if (!v) return;
    const W = 300;
    if (anchor) {
      const r = anchor.getBoundingClientRect();
      const left = Math.round(Math.min(r.left, innerWidth - W - 12));
      setAt({ left, top: Math.round(r.bottom + 6), origin: `${Math.round(r.left - left + 12)}px 0` });
    } else {
      const r = (v.dom.closest(".scroller") ?? v.dom).getBoundingClientRect();
      setAt({ left: Math.round(r.right - W - 20), top: Math.round(r.top + 12), origin: "100% 0" });
    }
  }, [view]);

  const close = useCallback(() => { setAt(null); view()?.focus(); }, [view]);

  const apply = useCallback((r: TidyResult) => {
    const v = view(); if (!v) return;
    setAt(null);
    if (!r.changes.length) return;
    const before = v.state.doc;
    const cs = ChangeSet.of(r.changes, before.length);
    v.dispatch({ changes: cs, userEvent: "input.tidy" });
    v.focus();
    const after = v.state.doc;
    const inverse = cs.invert(before);
    say(`已整理 ${r.total.toLocaleString()} 处`, { label: "撤销", run: () => {
      const w = view();
      if (!w) return;
      // 整理之后又打了字：改用编辑器的撤销历史，不硬套旧的改动
      if (w.state.doc !== after) { say("整理之后正文又改过了，用 ⌘Z 逐步撤销"); return; }
      w.dispatch({ changes: inverse, userEvent: "undo.tidy" });
    } });
  }, [view, say]);

  const v = view();
  const node = <Presence ms={110}>{at && v && <TidyPanel view={v} rules={rules} text={text} at={at} onApply={apply} onClose={close}
    onSettings={() => { setAt(null); openSettings(); }} />}</Presence>;
  return { open, node };
}
