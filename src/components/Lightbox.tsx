/**
 * 图片点开放大（阅读模式）：
 * - 遮罩用 var(--scrim)；图片从正文里原来的位置长出来（量好原位和终点，用 transform 过去），退场比进场短；
 * - ←→ 翻看本文所有图片，滚轮或触控板缩放（以指针处为中心），放大后可以拖着看；
 * - Esc 或点遮罩关闭；下面显示图注和第几张。
 */
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { Icon } from "./Icons";

export interface LightImage { url: string; alt: string }

const reduced = () => matchMedia("(prefers-reduced-motion: reduce)").matches;

export function Lightbox({ images, index, origin, onClose }: { images: LightImage[]; index: number; origin: DOMRect | null; onClose: () => void }) {
  const [i, setI] = useState(index);
  const [z, setZ] = useState({ s: 1, x: 0, y: 0 });
  const img = useRef<HTMLImageElement>(null);
  const grown = useRef(false);
  const drag = useRef<{ x: number; y: number; ox: number; oy: number } | null>(null);
  const cur = images[i];

  const go = (d: number) => { if (images.length > 1) { setI((n) => (n + d + images.length) % images.length); setZ({ s: 1, x: 0, y: 0 }); } };
  useEffect(() => {
    const f = (e: KeyboardEvent) => {
      if (e.key === "Escape") { e.stopPropagation(); e.preventDefault(); onClose(); }
      else if (e.key === "ArrowLeft") { e.preventDefault(); e.stopPropagation(); go(-1); }
      else if (e.key === "ArrowRight") { e.preventDefault(); e.stopPropagation(); go(1); }
    };
    addEventListener("keydown", f, true);
    return () => removeEventListener("keydown", f, true);
  });

  /** 第一张：从正文里原来的位置长出来 */
  const grow = () => {
    const el = img.current;
    if (!el || grown.current) return;
    grown.current = true;
    if (!origin || reduced()) return;
    const f = el.getBoundingClientRect();
    if (!f.width || !f.height) return;
    const sx = origin.width / f.width, sy = origin.height / f.height;
    el.style.transition = "none";
    el.style.transformOrigin = "0 0";
    el.style.transform = `translate(${Math.round(origin.left - f.left)}px, ${Math.round(origin.top - f.top)}px) scale(${sx}, ${sy})`;
    void el.offsetWidth;
    el.style.transition = "transform 260ms var(--ease)";
    el.style.transform = "";
    window.setTimeout(() => { if (el) { el.style.transition = ""; el.style.transformOrigin = ""; } }, 280);
  };
  useLayoutEffect(() => { if (img.current?.complete) grow(); });

  const onWheel = (e: React.WheelEvent) => {
    const el = img.current; if (!el) return;
    const r = el.getBoundingClientRect();
    setZ((p) => {
      const s = Math.min(8, Math.max(1, p.s * Math.exp(-e.deltaY * 0.0025)));
      if (s === 1) return { s: 1, x: 0, y: 0 };
      // 以指针处为中心缩放：指针下的那一点缩放前后不动
      const cx = r.left + r.width / 2 - p.x, cy = r.top + r.height / 2 - p.y; // 没缩放时图片中心
      const px = e.clientX - cx, py = e.clientY - cy;
      return { s, x: Math.round(px - (px - p.x) * (s / p.s)), y: Math.round(py - (py - p.y) * (s / p.s)) };
    });
  };

  return (
    <div className="lightbox" role="dialog" aria-label="查看图片" onWheel={onWheel}
      onMouseDown={(e) => {
        if (e.target === img.current && z.s > 1) { drag.current = { x: e.clientX, y: e.clientY, ox: z.x, oy: z.y }; e.preventDefault(); return; }
        if (!(e.target as HTMLElement).closest("img, button, figcaption")) onClose();
      }}
      onMouseMove={(e) => { const d = drag.current; if (d) setZ((p) => ({ ...p, x: Math.round(d.ox + e.clientX - d.x), y: Math.round(d.oy + e.clientY - d.y) })); }}
      onMouseUp={() => { drag.current = null; }}>
      <figure>
        <div className="lb-stage">
          <img ref={img} key={cur.url} src={cur.url} alt={cur.alt} draggable={false} onLoad={grow} className={z.s > 1 ? "zoomed" : ""}
            style={z.s !== 1 ? { translate: `${z.x}px ${z.y}px`, scale: String(z.s) } : undefined} />
        </div>
        <figcaption>
          {cur.alt && <span className="lb-alt">{cur.alt}</span>}
          {images.length > 1 && <span className="lb-n num">{i + 1} / {images.length}</span>}
        </figcaption>
      </figure>
      {images.length > 1 && <>
        <button className="lb-nav l" aria-label="上一张" onClick={() => go(-1)}><Icon name="back" size={18} /></button>
        <button className="lb-nav r" aria-label="下一张" onClick={() => go(1)}><Icon name="back" size={18} /></button>
      </>}
      <button className="lb-x ib" aria-label="关闭" onClick={onClose}><Icon name="close" size={18} /></button>
    </div>
  );
}
