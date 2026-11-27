/**
 * 统一的悬停提示（H33）：接管按钮上的 title，不再用浏览器原生的提示（出现慢、样式是系统的、不跟深浅色、不能显示键帽）。
 * - 名称在左，结尾的快捷键（⌘⇧E、Ctrl+Shift+E）拆出来显示成右对齐、弱化的键帽；
 * - 停留约 400ms 出现，移开就收；只放文字，不放可点的东西；
 * - 只接管按钮类元素（button、[role=button]、.tip），输入框、正文里的 title 照旧。
 */
import { useEffect, useRef, useState } from "react";

const KEY_TAIL = /\s+((?:[⌘⇧⌥⌃]+\s?[^\s⌘⇧⌥⌃]+|(?:(?:Ctrl|Alt|Shift|Cmd)\+)+[^\s+]+)(?:\s*\/\s*(?:[⌘⇧⌥⌃]+\s?[^\s⌘⇧⌥⌃]+|(?:(?:Ctrl|Alt|Shift|Cmd)\+)+[^\s+]+))*)$/;

/** 「导出 ⌘⇧E」→ ["导出", "⌘⇧E"] */
export function splitTip(t: string): [string, string] {
  const m = t.match(KEY_TAIL);
  return m ? [t.slice(0, m.index).trim(), m[1]] : [t, ""];
}

export function TooltipLayer() {
  const [tip, setTip] = useState<{ text: string; keys: string; x: number; y: number; below: boolean } | null>(null);
  const timer = useRef(0);
  const cur = useRef<HTMLElement | null>(null);
  useEffect(() => {
    const restore = () => {
      const el = cur.current;
      if (el && el.dataset.tip !== undefined) { el.title = el.dataset.tip; delete el.dataset.tip; }
      cur.current = null;
    };
    const hide = () => { clearTimeout(timer.current); setTip(null); restore(); };
    const over = (e: MouseEvent) => {
      const el = (e.target as HTMLElement | null)?.closest<HTMLElement>("button[title], [role=button][title], .tip[title], [role=tab][title]");
      if (!el || el === cur.current) return;
      hide();
      const text = el.title;
      if (!text) return;
      // 先把 title 收起来，免得原生提示也冒出来；离开时还回去
      el.dataset.tip = text;
      el.removeAttribute("title");
      cur.current = el;
      timer.current = window.setTimeout(() => {
        if (!document.contains(el)) return;
        const r = el.getBoundingClientRect();
        const [t, k] = splitTip(text);
        const below = r.bottom + 40 < innerHeight;
        setTip({ text: t, keys: k, x: Math.round(r.left + r.width / 2), y: Math.round(below ? r.bottom + 6 : r.top - 6), below });
      }, 400);
    };
    const out = (e: MouseEvent) => { if (cur.current && !cur.current.contains(e.relatedTarget as Node)) hide(); };
    addEventListener("mouseover", over, true);
    addEventListener("mouseout", out, true);
    addEventListener("mousedown", hide, true);
    addEventListener("keydown", hide, true);
    addEventListener("scroll", hide, true);
    return () => {
      removeEventListener("mouseover", over, true); removeEventListener("mouseout", out, true);
      removeEventListener("mousedown", hide, true); removeEventListener("keydown", hide, true); removeEventListener("scroll", hide, true);
      hide();
    };
  }, []);
  const ref = useRef<HTMLDivElement>(null);
  const [left, setLeft] = useState(0);
  useEffect(() => {
    if (!tip || !ref.current) return;
    const w = ref.current.offsetWidth;
    setLeft(Math.round(Math.max(6, Math.min(tip.x - w / 2, innerWidth - w - 6))));
  }, [tip]);
  if (!tip) return null;
  return (
    <div ref={ref} className={"hm-tip" + (tip.below ? "" : " up")} role="tooltip" style={{ left, top: tip.y }}>
      <span>{tip.text}</span>{tip.keys && <kbd>{tip.keys}</kbd>}
    </div>
  );
}
