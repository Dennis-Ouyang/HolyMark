/**
 * 弹出菜单：文件树右键、文件夹名下拉都用它。挂在 body 上，靠近窗口边缘时自动翻到另一边；
 * 方向键选择、回车执行、Esc 或点外面关闭。
 */
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Icon } from "./Icons";
import { kbd } from "../lib/platform";

export type MenuEntry =
  | { sep: true }
  | { head: string }
  | { label: string; icon?: string; hint?: string; danger?: boolean; disabled?: boolean; run: () => void };

export function Menu({ x, y, items, onClose, minWidth = 200 }: { x: number; y: number; items: MenuEntry[]; onClose: () => void; minWidth?: number }) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ left: x, top: y, origin: "0 0" });
  const actionable = items.map((it, i) => ("run" in it && !it.disabled ? i : -1)).filter((i) => i >= 0);
  const [hi, setHi] = useState(-1);

  useLayoutEffect(() => {
    const el = ref.current; if (!el) return;
    const r = el.getBoundingClientRect();
    const left = Math.max(6, Math.min(x, innerWidth - r.width - 6));
    const up = y + r.height > innerHeight - 6;
    const top = up ? Math.max(6, y - r.height) : y;
    // 从点击的位置长出来：翻到上方、被右边挤回来时，缩放原点跟着落在鼠标那一点
    setPos({ left, top, origin: `${Math.round(x - left)}px ${Math.round(y - top)}px` });
  }, [x, y]);
  useEffect(() => {
    const down = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) onClose(); };
    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); onClose(); }
      else if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        e.preventDefault();
        const k = actionable.indexOf(hi), n = actionable.length;
        setHi(actionable[((k < 0 ? (e.key === "ArrowDown" ? -1 : 0) : k) + (e.key === "ArrowDown" ? 1 : -1) + n) % n]);
      } else if (e.key === "Enter" && hi >= 0) { e.preventDefault(); const it = items[hi]; if ("run" in it) { onClose(); it.run(); } }
    };
    addEventListener("mousedown", down, true);
    addEventListener("keydown", key, true);
    addEventListener("blur", onClose);
    return () => { removeEventListener("mousedown", down, true); removeEventListener("keydown", key, true); removeEventListener("blur", onClose); };
  }, [onClose, hi, items, actionable]);

  return createPortal(
    <div ref={ref} className="menu" role="menu" style={{ left: pos.left, top: pos.top, minWidth, transformOrigin: pos.origin }} onContextMenu={(e) => e.preventDefault()}>
      {items.map((it, i) => {
        if ("sep" in it) return <div key={i} className="menu-sep" role="separator" />;
        if ("head" in it) return <div key={i} className="menu-head">{it.head}</div>;
        return (
          <button key={i} type="button" role="menuitem" disabled={it.disabled} className={"menu-item" + (i === hi ? " hi" : "") + (it.danger ? " danger" : "")}
            onMouseMove={() => setHi(i)} onClick={() => { onClose(); it.run(); }}>
            <span className="mi">{it.icon && <Icon name={it.icon} size={14} />}</span>
            <span className="ml">{it.label}</span>
            {it.hint && <span className="mh">{kbd(it.hint)}</span>}
          </button>
        );
      })}
    </div>,
    document.body,
  );
}
