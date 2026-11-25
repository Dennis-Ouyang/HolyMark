/**
 * 单选：分段控件。设置、导出、功能区里所有“几个选项选一个”的地方都用它。
 * 选中的那一格下面垫一块滑块，切换时滑过去；高度和下拉、数字输入一样是 28px，放在一行里能对齐。
 * 值不在选项里时（比如页边距是自定义的数字）不显示滑块。
 */
import { useLayoutEffect, useRef, useState } from "react";

interface Props<T extends string | boolean> {
  value: T;
  options: [T, string][];
  onChange: (v: T) => void;
  label: string;
  /** 撑满所在的格子，每个选项等宽 */
  full?: boolean;
  disabled?: boolean;
}

export function Segmented<T extends string | boolean>({ value, options, onChange, label, full, disabled }: Props<T>) {
  const box = useRef<HTMLDivElement>(null);
  const [thumb, setThumb] = useState<{ x: number; w: number } | null>(null);
  const [ready, setReady] = useState(false);
  const idx = options.findIndex(([v]) => v === value);

  useLayoutEffect(() => {
    const el = box.current;
    if (!el) return;
    const measure = () => {
      const b = el.querySelectorAll<HTMLElement>("button")[idx];
      setThumb(b ? { x: b.offsetLeft, w: b.offsetWidth } : null);
    };
    measure();
    // 第一次量完再打开动画，免得一打开就看到滑块从左边滑过来
    const t = requestAnimationFrame(() => setReady(true));
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => { cancelAnimationFrame(t); ro.disconnect(); };
  }, [idx, options.length, options.map(([, l]) => l).join("|")]);

  const move = (d: number) => {
    const n = options.length;
    const i = ((idx < 0 ? 0 : idx) + d + n) % n;
    onChange(options[i][0]);
    box.current?.querySelectorAll<HTMLElement>("button")[i]?.focus();
  };

  return (
    <div ref={box} className={"segm" + (full ? " full" : "") + (ready ? " ready" : "") + (disabled ? " disabled" : "")} role="radiogroup" aria-label={label}
      onKeyDown={(e) => {
        if (e.key === "ArrowRight" || e.key === "ArrowDown") { e.preventDefault(); move(1); }
        if (e.key === "ArrowLeft" || e.key === "ArrowUp") { e.preventDefault(); move(-1); }
      }}>
      {thumb && <span className="thumb" style={{ transform: `translateX(${thumb.x}px)`, width: thumb.w }} aria-hidden="true" />}
      {options.map(([v, l], i) => (
        <button key={String(v)} type="button" role="radio" aria-checked={v === value} tabIndex={v === value || (idx < 0 && i === 0) ? 0 : -1}
          className={v === value ? "on" : ""} disabled={disabled} onClick={() => onChange(v)}>{l}</button>
      ))}
    </div>
  );
}
