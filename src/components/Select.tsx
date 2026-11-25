/**
 * 统一的下拉组件。所有下拉（段落类型、设置、字体）都用它，外观和交互一致：
 * 按钮 + 浮层列表，当前项打勾，方向键选择，回车确认，Esc 关闭，点外面关闭。
 * 浮层挂在 body 上用 fixed 定位，不会被侧栏或工具栏裁掉。
 */
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Icon } from "./Icons";
import type { FontFamily } from "../lib/backend";

export interface Option<T extends string> { value: T; label: string; hint?: string; style?: React.CSSProperties; group?: string }

interface Props<T extends string> {
  value: T;
  options: Option<T>[];
  onChange: (v: T) => void;
  ariaLabel: string;
  /** 不抢焦点：浮动工具栏里用，点下拉时编辑器的选区保持不动 */
  keepFocus?: boolean;
  /** 可搜索（字体列表这类长列表） */
  searchable?: boolean;
  placeholder?: string;
  className?: string;
  width?: number;
  buttonStyle?: React.CSSProperties;
}

export function Select<T extends string>({ value, options, onChange, ariaLabel, keepFocus, searchable, placeholder, className, width, buttonStyle }: Props<T>) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [hi, setHi] = useState(0);
  const [pos, setPos] = useState<{ left: number; top: number; up: boolean; minW: number }>({ left: 0, top: 0, up: false, minW: 0 });
  const btn = useRef<HTMLButtonElement>(null);
  const list = useRef<HTMLDivElement>(null);
  const current = options.find((o) => o.value === value);

  const shown = useMemo(() => {
    const ql = q.trim().toLowerCase();
    return ql ? options.filter((o) => (o.label + " " + o.value + " " + (o.hint || "")).toLowerCase().includes(ql)) : options;
  }, [q, options]);

  const place = () => {
    const r = btn.current!.getBoundingClientRect();
    const h = Math.min(320, shown.length * 32 + (searchable ? 48 : 12));
    const up = r.bottom + h + 8 > innerHeight && r.top > h + 8;
    setPos({ left: Math.min(r.left, innerWidth - Math.max(width || 0, r.width) - 8), top: up ? r.top - 4 : r.bottom + 4, up, minW: r.width });
  };
  const openList = () => {
    place();
    setQ("");
    setHi(Math.max(0, options.findIndex((o) => o.value === value)));
    setOpen(true);
  };
  useLayoutEffect(() => { if (open) list.current?.querySelector(".opt.hi")?.scrollIntoView({ block: "nearest" }); }, [hi, open]);
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => { if (!list.current?.contains(e.target as Node) && !btn.current?.contains(e.target as Node)) setOpen(false); };
    const onScroll = (e: Event) => { if (!list.current?.contains(e.target as Node)) setOpen(false); };
    addEventListener("mousedown", close, true);
    addEventListener("scroll", onScroll, true);
    addEventListener("resize", () => setOpen(false), { once: true });
    return () => { removeEventListener("mousedown", close, true); removeEventListener("scroll", onScroll, true); };
  }, [open]);

  const choose = (o?: Option<T>) => { if (o) onChange(o.value); setOpen(false); if (!keepFocus) btn.current?.focus(); };
  const onKey = (e: React.KeyboardEvent) => {
    if (e.nativeEvent.isComposing) return;
    if (!open && (e.key === "Enter" || e.key === " " || e.key === "ArrowDown")) { e.preventDefault(); openList(); return; }
    if (!open) return;
    if (e.key === "ArrowDown" || e.key === "ArrowUp") { e.preventDefault(); setHi((h) => (h + (e.key === "ArrowDown" ? 1 : -1) + shown.length) % Math.max(1, shown.length)); }
    else if (e.key === "Enter") { e.preventDefault(); choose(shown[hi]); }
    else if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); setOpen(false); }
  };

  let group = "";
  return (
    <>
      <button ref={btn} type="button" className={"select-btn" + (open ? " open" : "") + (className ? " " + className : "")} aria-haspopup="listbox" aria-expanded={open} aria-label={ariaLabel}
        style={buttonStyle} onMouseDown={(e) => { if (keepFocus) e.preventDefault(); }} onClick={() => (open ? setOpen(false) : openList())} onKeyDown={onKey}>
        <span className="sv" style={current?.style}>{current?.label ?? placeholder ?? "请选择"}</span>
        <Icon name="chev" size={12} />
      </button>
      {open && createPortal(
        <div ref={list} className={"select-pop" + (pos.up ? " up" : "")} role="listbox" aria-label={ariaLabel}
          style={{ left: pos.left, [pos.up ? "bottom" : "top"]: pos.up ? innerHeight - pos.top : pos.top, minWidth: Math.max(pos.minW, width || 0) } as React.CSSProperties}
          onMouseDown={(e) => { if (keepFocus && (e.target as HTMLElement).tagName !== "INPUT") e.preventDefault(); }} onKeyDown={onKey}>
          {searchable && (
            <div className="select-search"><Icon name="search" size={13} />
              <input autoFocus value={q} placeholder="搜索" aria-label="搜索" onChange={(e) => { setQ(e.target.value); setHi(0); }} onKeyDown={onKey} />
            </div>
          )}
          <div className="select-list">
            {shown.length ? shown.map((o, i) => {
              const head = o.group && o.group !== group ? <div className="select-group">{(group = o.group)}</div> : null;
              return (
                <div key={o.value + i}>
                  {head}
                  <div role="option" aria-selected={o.value === value} className={"opt" + (i === hi ? " hi" : "") + (o.value === value ? " cur" : "")}
                    onMouseMove={() => setHi(i)} onClick={() => choose(o)}>
                    <span className="ck">{o.value === value && <Icon name="check" size={13} />}</span>
                    <span className="olbl" style={o.style}>{o.label}</span>
                    {o.hint && <span className="oh">{o.hint}</span>}
                  </div>
                </div>
              );
            }) : <div className="select-empty">没有匹配的项</div>}
          </div>
        </div>,
        document.body,
      )}
    </>
  );
}

/** 字体选择：列出系统已安装的字体，中文字体在前，每一项用它自己的字体显示 */
export function FontSelect({ value, fonts, onChange, allowDefault, defaultLabel, ariaLabel, keepFocus }: {
  value: string; fonts: FontFamily[]; onChange: (v: string) => void; allowDefault?: boolean; defaultLabel?: string; ariaLabel: string; keepFocus?: boolean;
}) {
  const options = useMemo(() => {
    const o: Option<string>[] = [];
    if (allowDefault) o.push({ value: "", label: defaultLabel || "跟随默认设置", group: "默认" });
    const known = new Set<string>();
    fonts.forEach((f) => { known.add(f.name); o.push({ value: f.name, label: f.display, hint: f.display !== f.name ? f.name : undefined, style: { fontFamily: `"${f.name}"` }, group: f.cjk ? "中文字体" : "西文字体" }); });
    if (value && !known.has(value)) o.unshift({ value, label: value, hint: "未安装", group: "当前" });
    return o;
  }, [fonts, value, allowDefault, defaultLabel]);
  return <Select value={value} options={options} onChange={onChange} ariaLabel={ariaLabel} searchable width={280} keepFocus={keepFocus} className="font-select" />;
}
