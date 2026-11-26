/**
 * N12 公式符号面板：按类别排好的常用符号，点一下插入到光标处，最近用过的排在最前。
 * 光标在公式里就直接插入；不在公式里就包成 $…$ 插入。面板开着时焦点留在正文里，可以连续点。
 */
import { useEffect, useMemo, useState } from "react";
import type { EditorView } from "@codemirror/view";
import { snippet } from "@codemirror/autocomplete";
import katex from "katex";
import { SYMBOL_CATS, SymbolCat, TEX, texInsert, texPreview, TexItem } from "../lib/latex";
import { inMath } from "../editor/mathComplete";
import { Icon } from "./Icons";

const RECENT_KEY = "holymark-recent-tex";
const html = new Map<string, string>();
function tex(t: TexItem) {
  const p = texPreview(t);
  let h = html.get(p);
  if (h === undefined) { try { h = katex.renderToString(p, { throwOnError: false }); } catch { h = p; } html.set(p, h); }
  return h;
}

export function insertTex(view: EditorView, t: TexItem) {
  const r = view.state.selection.main;
  const tpl = texInsert(t);
  const wrap = !inMath(view.state, r.head);
  snippet(wrap ? `$${tpl}$` : tpl)(view, null, r.from, r.to);
  view.focus();
}

export function SymbolPanel({ view, at, onClose }: { view: EditorView; at: { left: number; top: number; origin: string }; onClose: () => void }) {
  const [recent, setRecent] = useState<string[]>(() => { try { return JSON.parse(localStorage.getItem(RECENT_KEY) || "[]"); } catch { return []; } });
  const [cat, setCat] = useState<SymbolCat | "recent">(recent.length ? "recent" : "greek");
  const items = useMemo(() => cat === "recent"
    ? recent.map((c) => TEX.find((t) => t.cmd === c)).filter((x): x is TexItem => !!x)
    : TEX.filter((t) => t.cat === cat), [cat, recent]);
  useEffect(() => {
    const f = (e: KeyboardEvent) => { if (e.key === "Escape") { e.stopPropagation(); e.preventDefault(); onClose(); } };
    addEventListener("keydown", f, true);
    return () => removeEventListener("keydown", f, true);
  }, [onClose]);
  const pick = (t: TexItem) => {
    insertTex(view, t);
    const n = [t.cmd, ...recent.filter((x) => x !== t.cmd)].slice(0, 16);
    try { localStorage.setItem(RECENT_KEY, JSON.stringify(n)); } catch { /* 存不了就算了 */ }
    // 正在看「最近」时不重排，免得点着点着按钮换了位置
    if (cat !== "recent") setRecent(n);
  };
  const tabs: [SymbolCat | "recent", string][] = [...(recent.length ? [["recent", "最近"] as [SymbolCat | "recent", string]] : []), ...SYMBOL_CATS];
  return (
    <div className="hm-float symp" role="dialog" aria-label="公式符号" style={{ left: at.left, top: at.top, transformOrigin: at.origin }} onMouseDown={(e) => e.preventDefault()}>
      <div className="sp-tabs" role="tablist">
        {tabs.map(([k, l]) => <button key={k} role="tab" aria-selected={cat === k} className={cat === k ? "on" : ""} onClick={() => setCat(k)}>{l}</button>)}
        <button className="ib sp-x" aria-label="关闭" onClick={onClose}><Icon name="close" size={14} /></button>
      </div>
      <div className={"sp-grid" + (cat === "struct" ? " wide" : "")}>
        {items.map((t) => <button key={t.cmd} className="sp-sym" title={t.info ? `${t.info}  ${t.cmd}` : t.cmd} onClick={() => pick(t)} dangerouslySetInnerHTML={{ __html: tex(t) }} />)}
      </div>
    </div>
  );
}
