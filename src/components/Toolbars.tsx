import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { NumberField } from "./NumberField";
import type { EditorView } from "@codemirror/view";
import { BlockKind, currentBlock, insertBlock, insertLink, insertNote, setBlock, tableMarkdown, toggleInline } from "../editor/commands";
import { Icon } from "./Icons";
import { FontSelect, Select } from "./Select";
import type { Settings } from "../lib/settings";
import type { FontFamily } from "../lib/backend";

export const BLOCKS: { value: BlockKind; label: string }[] = [
  { value: "p", label: "正文" }, { value: "h1", label: "标题 1" }, { value: "h2", label: "标题 2" }, { value: "h3", label: "标题 3" },
  { value: "quote", label: "引用" }, { value: "ul", label: "无序列表" }, { value: "ol", label: "有序列表" }, { value: "task", label: "任务列表" },
];
const keep = (e: React.MouseEvent) => e.preventDefault(); // 点按钮不让编辑器失去选区

function TB({ title, onClick, children, className }: { title: string; onClick: () => void; children: React.ReactNode; className?: string }) {
  return <button type="button" className={"rb" + (className ? " " + className : "")} title={title} aria-label={title} onMouseDown={keep} onClick={onClick}>{children}</button>;
}

/* ---------------- 选中文字时的浮动工具栏 ---------------- */
export function FloatingToolbar({ view, tick, author }: { view: EditorView | null; tick: number; author: string }) {
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);
  const [kind, setKind] = useState<BlockKind>("p");
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!view) return;
    const r = view.state.selection.main;
    if (r.empty || !view.hasFocus) { setPos(null); return; }
    const a = view.coordsAtPos(r.from), b = view.coordsAtPos(r.to);
    const host = view.dom.closest(".main")?.getBoundingClientRect();
    if (!a || !b || !host) { setPos(null); return; }
    const w = ref.current?.offsetWidth || 420;
    const mid = (Math.min(a.left, b.left) + Math.max(a.right, b.right)) / 2 - host.left;
    let top = Math.min(a.top, b.top) - host.top - 48;
    if (top < 4) top = Math.max(a.bottom, b.bottom) - host.top + 8;
    setPos({ left: Math.min(Math.max(w / 2 + 8, mid), host.width - w / 2 - 8), top });
    setKind(currentBlock(view));
  }, [view, tick]);
  if (!pos || !view) return null;
  return (
    <div className="ftb" ref={ref} style={{ left: pos.left, top: pos.top }} role="toolbar" aria-label="格式">
      <Select value={kind} options={BLOCKS} onChange={(k) => setBlock(view, k)} ariaLabel="段落类型" keepFocus className="ghost" />
      <span className="sep" />
      <TB title="粗体 ⌘B" onClick={() => toggleInline(view, "bold")}><b>B</b></TB>
      <TB title="斜体 ⌘I" onClick={() => toggleInline(view, "italic")}><i className="serif-i">I</i></TB>
      <TB title="删除线 ⌘⇧X" onClick={() => toggleInline(view, "strike")}><s>S</s></TB>
      <TB title="行内代码 ⌘E" onClick={() => toggleInline(view, "code")}><Icon name="code" /></TB>
      <TB title="行内公式 ⌘⇧M" onClick={() => toggleInline(view, "math")}><Icon name="math" /></TB>
      <TB title="链接 ⌘⇧K" onClick={() => insertLink(view)}><Icon name="link" /></TB>
      <span className="sep" />
      <TB title="批注 ⌘⌥M" onClick={() => insertNote(view, author)}><Icon name="note" /><span>批注</span></TB>
    </div>
  );
}

/* ---------------- 顶部功能区 ---------------- */
interface RibbonProps {
  view: EditorView | null;
  author: string;
  settings: Settings;
  fonts: FontFamily[];
  layout: Record<string, string>;
  collapsed: boolean;
  setCollapsed: (c: boolean) => void;
  onLayout: (l: Record<string, string>) => void;
  onSaveVersion: () => void;
  onPickImage: () => void;
  onCite: () => void;
}

export function Ribbon({ view, author, settings, fonts, layout, collapsed, setCollapsed, onLayout, onSaveVersion, onPickImage, onCite }: RibbonProps) {
  const [tab, setTab] = useState<"home" | "insert" | "layout">("home");
  const [grid, setGrid] = useState<{ r: number; c: number } | null>(null);
  const [gridOpen, setGridOpen] = useState(false);
  const v = view;
  const run = (f: (v: EditorView) => void) => () => { if (v) f(v); };
  const big = (icon: string, label: string, title: string, f: () => void) => (
    <button type="button" className="rb tall" title={title} aria-label={title} onMouseDown={keep} onClick={f}><Icon name={icon} size={18} /><span>{label}</span></button>
  );
  const num = (k: string, label: string, ph: string, attrs: { min: number; max: number; step?: number }, unit?: string) => (
    <label className="rfield">{label}
      <NumberField value={layout[k] || ""} placeholder={ph} {...attrs} unit={unit} ariaLabel={label} onCommit={(val) => onLayout({ ...layout, [k]: val })} />
    </label>
  );
  const gridBtn = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!gridOpen) return;
    const close = (e: MouseEvent) => { if (!(e.target as HTMLElement).closest(".gridpop, .grid-anchor")) setGridOpen(false); };
    addEventListener("mousedown", close);
    return () => removeEventListener("mousedown", close);
  }, [gridOpen]);
  return (
    <div className={"ribbon" + (collapsed ? " collapsed" : "")}>
      <div className="rtabs" role="tablist">
        {([["home", "开始"], ["insert", "插入"], ["layout", "本文版式"]] as const).map(([k, l]) => (
          <button key={k} role="tab" aria-selected={tab === k} className={"rtab" + (tab === k ? " on" : "")}
            onClick={() => { setTab(k); setCollapsed(false); }} onDoubleClick={() => setCollapsed(!collapsed)}>{l}</button>
        ))}
        <button className="ib collapse" title={collapsed ? "展开功能区 ⌘⌥R" : "折叠功能区 ⌘⌥R"} aria-label="折叠功能区" onClick={() => setCollapsed(!collapsed)}><Icon name="up" /></button>
      </div>
      <div className="rbody-wrap" aria-hidden={collapsed}>
        <div className="rbody" key={tab}>
          {tab === "home" && <>
            <div className="rgrp"><div className="row">{BLOCKS.slice(0, 4).map((b) => <TB key={b.value} title={b.label} onClick={run((x) => setBlock(x, b.value))}>{b.label}</TB>)}</div><span className="gl">段落</span></div>
            <div className="rgrp"><div className="row">
              <TB title="粗体 ⌘B" onClick={run((x) => toggleInline(x, "bold"))}><b>B</b></TB>
              <TB title="斜体 ⌘I" onClick={run((x) => toggleInline(x, "italic"))}><i className="serif-i">I</i></TB>
              <TB title="删除线 ⌘⇧X" onClick={run((x) => toggleInline(x, "strike"))}><s>S</s></TB>
              <TB title="行内代码 ⌘E" onClick={run((x) => toggleInline(x, "code"))}><Icon name="code" /></TB>
              <TB title="行内公式 ⌘⇧M" onClick={run((x) => toggleInline(x, "math"))}><Icon name="math" /></TB>
              <TB title="链接 ⌘⇧K" onClick={run((x) => insertLink(x))}><Icon name="link" /></TB>
            </div><span className="gl">文字</span></div>
            <div className="rgrp"><div className="row">
              <TB title="无序列表 ⌘⇧8" onClick={run((x) => setBlock(x, "ul"))}><Icon name="ul" /></TB>
              <TB title="有序列表 ⌘⇧7" onClick={run((x) => setBlock(x, "ol"))}><Icon name="ol" /></TB>
              <TB title="任务列表 ⌘⇧9" onClick={run((x) => setBlock(x, "task"))}><Icon name="task" /></TB>
              <TB title="引用 ⌘⇧." onClick={run((x) => setBlock(x, "quote"))}><Icon name="quote" /></TB>
            </div><span className="gl">列表与引用</span></div>
            <div className="rgrp"><div className="row">
              <TB title="给选中文字加批注 ⌘⌥M" onClick={run((x) => insertNote(x, author))}><Icon name="note" /><span>批注</span></TB>
              <TB title="保存版本 ⌘S" onClick={onSaveVersion}>保存版本</TB>
            </div><span className="gl">审阅</span></div>
          </>}
          {tab === "insert" && <>
            <div className="rgrp"><div className="row">
              <div className="rb-wrap grid-anchor" ref={gridBtn}>
                {big("table", "表格", "插入表格", () => setGridOpen(!gridOpen))}
                {gridOpen && gridBtn.current && createPortal(
                  <div className="pop gridpop" style={{ left: gridBtn.current.getBoundingClientRect().left, top: gridBtn.current.getBoundingClientRect().bottom + 6 }} onMouseLeave={() => setGrid(null)}>
                    <div className="gridlbl">{grid ? `${grid.r} 行 × ${grid.c} 列` : "选择行列"}</div>
                    <div className="gridpick">{Array.from({ length: 48 }, (_, i) => { const r = Math.floor(i / 8) + 1, c = (i % 8) + 1; return (
                      <i key={i} className={grid && r <= grid.r && c <= grid.c ? "on" : ""} onMouseEnter={() => setGrid({ r, c })} onMouseDown={keep}
                        onClick={() => { setGridOpen(false); if (v) insertBlock(v, tableMarkdown(r, c), 2); }} />); })}</div>
                  </div>, document.body)}
              </div>
              {big("img", "图片", "插入图片 ⌘⇧I", onPickImage)}
              {big("codeb", "代码", "代码块 ⌘⌥C", run((x) => insertBlock(x, "```\n\n```", 4)))}
              {big("mathb", "公式", "公式块 ⌘⌥B", run((x) => insertBlock(x, "$$\n\n$$", 3)))}
              {big("mermaid", "图表", "Mermaid 图表", run((x) => insertBlock(x, "```mermaid\nflowchart LR\n  A[开始] --> B[结束]\n```", 11)))}
              {big("hr", "分隔线", "分隔线", run((x) => insertBlock(x, "---")))}
            </div><span className="gl">块</span></div>
            <div className="rgrp"><div className="row">{big("cite", "引用", "引用文献或文件 ⌘⇧C", onCite)}{big("link", "链接", "插入链接 ⌘⇧K", run((x) => insertLink(x)))}</div><span className="gl">引用与链接</span></div>
          </>}
          {tab === "layout" && <>
            <div className="rgrp"><div className="row">
              <label className="rfield">标题<FontSelect value={layout["heading-font"] || ""} fonts={fonts} allowDefault defaultLabel={`默认（${displayFont(settings.headingFont, fonts)}）`} ariaLabel="本文标题字体" onChange={(f) => onLayout({ ...layout, "heading-font": f })} /></label>
              <label className="rfield">正文<FontSelect value={layout["body-font"] || ""} fonts={fonts} allowDefault defaultLabel={`默认（${displayFont(settings.bodyFont, fonts)}）`} ariaLabel="本文正文字体" onChange={(f) => onLayout({ ...layout, "body-font": f })} /></label>
            </div><span className="gl">字体</span></div>
            <div className="rgrp"><div className="row">
              {num("font-size", "字号", String(settings.fontSize), { min: 12, max: 28 })}
              {num("line-height", "行距", String(settings.lineHeight), { min: 1.2, max: 2.6, step: 0.05 })}
              {num("measure", "版心", String(settings.measure), { min: 24, max: 60 }, "字")}
            </div><span className="gl">排版</span></div>
            <div className="rgrp"><div className="row"><TB title="清除本文版式" onClick={() => onLayout({})}>清除本文版式</TB></div><span className="gl">只对这一篇生效</span></div>
          </>}
        </div>
      </div>
    </div>
  );
}

export function displayFont(name: string, fonts: FontFamily[]) {
  return fonts.find((f) => f.name === name)?.display || name;
}
