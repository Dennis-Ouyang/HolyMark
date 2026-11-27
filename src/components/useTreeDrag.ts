/**
 * 树形列表里的拖放（H7），用鼠标事件实现（Tauri 开着系统文件拖入时，HTML5 拖放在 Windows 上不可靠）。
 * 做成通用的：调用方给出「这个元素对应哪个放置目标」「放下后做什么」，以后手动排序也能用。
 * - 按住拖动超过 4px 才算拖；拖的时候鼠标旁边跟一个小标签；
 * - 停在一个目标上约 600ms 触发 onHoverLong（文件夹自动展开）；
 * - Esc 取消。
 */
import { useCallback, useEffect, useRef, useState } from "react";

export interface TreeDragOptions<T> {
  /** 鼠标下面的元素对应的放置目标（比如文件夹路径）；不能放时返回 null */
  targetAt: (el: Element | null, item: T) => string | null;
  onDrop: (item: T, target: string) => void;
  onHoverLong?: (target: string) => void;
}

export function useTreeDrag<T>({ targetAt, onDrop, onHoverLong }: TreeDragOptions<T>) {
  const [drag, setDrag] = useState<{ item: T; label: string } | null>(null);
  const [over, setOver] = useState<string | null>(null);
  const ghost = useRef<HTMLDivElement | null>(null);
  const opts = useRef({ targetAt, onDrop, onHoverLong });
  opts.current = { targetAt, onDrop, onHoverLong };

  const start = useCallback((e: React.MouseEvent, item: T, label: string) => {
    if (e.button !== 0) return;
    const x0 = e.clientX, y0 = e.clientY;
    let active = false, target: string | null = null, timer = 0;
    const move = (ev: MouseEvent) => {
      if (!active) {
        if (Math.hypot(ev.clientX - x0, ev.clientY - y0) < 4) return;
        active = true;
        setDrag({ item, label });
        const g = document.createElement("div");
        g.className = "drag-ghost";
        g.textContent = label;
        document.body.append(g);
        document.body.classList.add("tree-dragging");
        ghost.current = g;
      }
      ghost.current!.style.left = ev.clientX + 12 + "px";
      ghost.current!.style.top = ev.clientY + 8 + "px";
      const t = opts.current.targetAt(document.elementFromPoint(ev.clientX, ev.clientY), item);
      if (t !== target) {
        target = t;
        setOver(t);
        clearTimeout(timer);
        if (t) timer = window.setTimeout(() => opts.current.onHoverLong?.(t), 600);
      }
    };
    const end = (drop: boolean) => {
      removeEventListener("mousemove", move);
      removeEventListener("mouseup", up);
      removeEventListener("keydown", key, true);
      clearTimeout(timer);
      if (!active) return;
      ghost.current?.remove(); ghost.current = null;
      document.body.classList.remove("tree-dragging");
      setDrag(null); setOver(null);
      if (drop && target) opts.current.onDrop(item, target);
      // 拖完松手时浏览器还会补一个 click，吞掉它，免得顺手打开了文件
      const swallow = (ce: MouseEvent) => { ce.stopPropagation(); ce.preventDefault(); };
      addEventListener("click", swallow, { capture: true, once: true });
      setTimeout(() => removeEventListener("click", swallow, { capture: true }), 0);
    };
    const up = () => end(true);
    const key = (ke: KeyboardEvent) => { if (ke.key === "Escape") { ke.stopPropagation(); end(false); } };
    addEventListener("mousemove", move);
    addEventListener("mouseup", up);
    addEventListener("keydown", key, true);
  }, []);

  useEffect(() => () => { ghost.current?.remove(); }, []);
  return { start, dragging: drag?.item ?? null, over };
}
