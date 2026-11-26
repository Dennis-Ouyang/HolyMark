import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { NumberField } from "./NumberField";
import type { EditorView } from "@codemirror/view";
import { BlockKind, currentBlock, indentList, InlineKind, insertBlock, insertLink, insertNote, setBlock, tableMarkdown, toggleInline } from "../editor/commands";
import { Icon } from "./Icons";
import { FontSelect, Select } from "./Select";
import type { Settings } from "../lib/settings";
import type { FontFamily } from "../lib/backend";
import { kbd } from "../lib/platform";

export const BLOCKS: { value: BlockKind; label: string }[] = [
  { value: "p", label: "正文" }, { value: "h1", label: "标题 1" }, { value: "h2", label: "标题 2" }, { value: "h3", label: "标题 3" },
  { value: "h4", label: "标题 4" }, { value: "h5", label: "标题 5" }, { value: "h6", label: "标题 6" },
  { value: "quote", label: "引用" }, { value: "ul", label: "无序列表" }, { value: "ol", label: "有序列表" }, { value: "task", label: "任务列表" },
];
const keep = (e: React.MouseEvent) => e.preventDefault(); // 点按钮不让编辑器失去选区

function TB({ title, onClick, children, className, on, disabled }: { title: string; onClick: () => void; children: React.ReactNode; className?: string; on?: boolean; disabled?: boolean }) {
  return <button type="button" className={"rb" + (className ? " " + className : "") + (on ? " on" : "")} title={kbd(title)} aria-label={title.replace(/\s*[⌘⇧⌥].*$/, "")}
    aria-pressed={on === undefined ? undefined : on} disabled={disabled} onMouseDown={keep} onClick={onClick}>{children}</button>;
}

/** 行内格式按钮：粗体、斜体、删除线、行内代码、公式 */
const INLINE: { k: InlineKind; title: string; icon: React.ReactNode }[] = [
  { k: "bold", title: "粗体 ⌘B", icon: <Icon name="bold" /> },
  { k: "italic", title: "斜体 ⌘I", icon: <Icon name="italic" /> },
  { k: "strike", title: "删除线 ⌘⇧X", icon: <Icon name="strike" /> },
  { k: "code", title: "行内代码 ⌘E", icon: <Icon name="code" /> },
  { k: "math", title: "行内公式 ⌘⇧M", icon: <Icon name="math" /> },
];
/** 功能区里多出来的：高亮、上标、下标 */
const MORE_INLINE: { k: InlineKind; title: string; icon: React.ReactNode }[] = [
  { k: "highlight", title: "高亮 ⌘⇧H", icon: <Icon name="highlight" /> },
  { k: "sup", title: "上标（x^2^）", icon: <Icon name="sup" /> },
  { k: "sub", title: "下标（H~2~O）", icon: <Icon name="sub" /> },
];

/* ---------------- 选中文字时的浮动工具栏 ---------------- */
export function FloatingToolbar({ view, tick, author, active }: { view: EditorView | null; tick: number; author: string; active: Set<InlineKind> }) {
  const [pos, setPos] = useState<{ left: number; top: number; below: boolean } | null>(null);
  const [kind, setKind] = useState<BlockKind>("p");
  const ref = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    if (!view) return;
    const r = view.state.selection.main;
    if (r.empty || !view.hasFocus) { setPos(null); return; }
    const a = view.coordsAtPos(r.from), b = view.coordsAtPos(r.to);
    const host = view.dom.closest(".main")?.getBoundingClientRect();
    if (!a || !b || !host) { setPos(null); return; }
    const w = ref.current?.offsetWidth || 380;
    const mid = (Math.min(a.left, b.left) + Math.max(a.right, b.right)) / 2 - host.left;
    let top = Math.min(a.top, b.top) - host.top - 46;
    const below = top < 4;
    if (below) top = Math.max(a.bottom, b.bottom) - host.top + 8;
    // 用整数像素定位，不用 translateX(-50%)：半像素会让 Windows 上的字发虚
    const left = Math.round(Math.min(Math.max(8, mid - w / 2), host.width - w - 8));
    // 从选区那一侧长出来：栏在上方时从底边中点缩放，翻到下方时从顶边
    setPos({ left, top: Math.round(top), below });
    setKind(currentBlock(view));
  }, [view, tick]);
  if (!pos || !view) return null;
  return (
    <div className={"ftb" + (pos.below ? " below" : "")} ref={ref} style={{ left: pos.left, top: pos.top }} role="toolbar" aria-label="格式">
      <Select value={kind} options={BLOCKS} onChange={(k) => setBlock(view, k)} ariaLabel="段落类型" keepFocus className="ghost" />
      <span className="sep" />
      {[...INLINE, MORE_INLINE[0]].map((x) => <TB key={x.k} title={x.title} on={active.has(x.k)} onClick={() => toggleInline(view, x.k, true)}>{x.icon}</TB>)}
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
  onPickImage: () => void;
  onCite: () => void;
  /** 中文排版整理，anchor 是按钮，浮层从它长出来 */
  onTidy: (anchor: HTMLElement) => void;
  active: Set<InlineKind>;
  block: BlockKind;
}

/** 段落样式：每一项按它自己的样子画出来，像 Word 的样式库 */
const STYLE_CHIPS: { value: BlockKind; label: string; title: string }[] = [
  { value: "p", label: "正文", title: "正文 ⌘0" }, { value: "h1", label: "标题 1", title: "标题 1 ⌘1" },
  { value: "h2", label: "标题 2", title: "标题 2 ⌘2" }, { value: "h3", label: "标题 3", title: "标题 3 ⌘3" },
];

/** 功能区放不下时（窗口窄、两侧栏都开着）可以横向滚动：两头出现箭头，滚轮也能左右滚 */
function useOverflow(dep: unknown) {
  const ref = useRef<HTMLDivElement>(null);
  const [edge, setEdge] = useState({ l: false, r: false });
  useLayoutEffect(() => {
    const el = ref.current; if (!el) return;
    const f = () => setEdge({ l: el.scrollLeft > 2, r: el.scrollLeft + el.clientWidth < el.scrollWidth - 2 });
    f();
    const ro = new ResizeObserver(f); ro.observe(el);
    el.addEventListener("scroll", f, { passive: true });
    const wheel = (e: WheelEvent) => { if (el.scrollWidth > el.clientWidth && Math.abs(e.deltaY) > Math.abs(e.deltaX)) { el.scrollLeft += e.deltaY; e.preventDefault(); } };
    el.addEventListener("wheel", wheel, { passive: false });
    return () => { ro.disconnect(); el.removeEventListener("scroll", f); el.removeEventListener("wheel", wheel); };
  }, [dep]);
  const scroll = (d: 1 | -1) => ref.current?.scrollBy({ left: d * ref.current.clientWidth * 0.6, behavior: "smooth" });
  return { ref, edge, scroll };
}

function Group({ label, children, className }: { label: string; children: React.ReactNode; className?: string }) {
  return <div className={"rgrp" + (className ? " " + className : "")} role="group" aria-label={label}><div className="row">{children}</div><span className="gl">{label}</span></div>;
}

export function Ribbon({ view, author, settings, fonts, layout, collapsed, setCollapsed, onLayout, onPickImage, onCite, onTidy, active, block }: RibbonProps) {
  const [tab, setTab] = useState<"home" | "insert" | "layout">("home");
  const [grid, setGrid] = useState<{ r: number; c: number } | null>(null);
  const [gridOpen, setGridOpen] = useState(false);
  const v = view;
  const run = (f: (v: EditorView) => void) => () => { if (v) f(v); };
  const big = (icon: string, label: string, title: string, f: () => void) => (
    <button type="button" className="rb tall" title={kbd(title)} aria-label={title.replace(/\s*[⌘⇧⌥].*$/, "")} onMouseDown={keep} onClick={f}><Icon name={icon} size={18} /><span>{label}</span></button>
  );
  const num = (k: string, label: string, ph: string, attrs: { min: number; max: number; step?: number }, unit?: string) => (
    <label className="rfield"><span>{label}</span>
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
  const hasLayout = ["heading-font", "body-font", "font-size", "line-height", "measure"].some((k) => layout[k]);
  const ov = useOverflow(tab);
  const isList = block === "ul" || block === "ol" || block === "task";
  return (
    <div className={"ribbon" + (collapsed ? " collapsed" : "")}>
      <div className="rtabs" role="tablist">
        {([["home", "开始"], ["insert", "插入"], ["layout", "版式"]] as const).map(([k, l]) => (
          <button key={k} role="tab" aria-selected={tab === k} className={"rtab" + (tab === k ? " on" : "")}
            onClick={() => { setTab(k); setCollapsed(false); }} onDoubleClick={() => setCollapsed(!collapsed)}>{l}{k === "layout" && hasLayout && <i className="rdot" title="这篇文章有单独的版式" />}</button>
        ))}
        <button className="ib collapse" title={kbd(collapsed ? "展开功能区 ⌘⌥R" : "折叠功能区 ⌘⌥R")} aria-label="折叠功能区" onClick={() => setCollapsed(!collapsed)}><Icon name="up" /></button>
      </div>
      <div className={"rbody-wrap" + (ov.edge.l ? " ml" : "") + (ov.edge.r ? " mr" : "")} aria-hidden={collapsed}>
        {ov.edge.l && <button type="button" className="rscroll l" aria-label="向左滚动功能区" onMouseDown={keep} onClick={() => ov.scroll(-1)}><Icon name="back" size={12} /></button>}
        {ov.edge.r && <button type="button" className="rscroll r" aria-label="向右滚动功能区" onMouseDown={keep} onClick={() => ov.scroll(1)}><Icon name="back" size={12} /></button>}
        <div className="rbody" key={tab} ref={ov.ref}>
          {tab === "home" && <>
            <Group label="段落样式" className="styles">
              {STYLE_CHIPS.map((c) => (
                <button key={c.value} type="button" className={"chip " + c.value + (block === c.value ? " on" : "")} title={kbd(c.title)} aria-pressed={block === c.value}
                  onMouseDown={keep} onClick={run((x) => setBlock(x, c.value))}><span>{c.label}</span></button>
              ))}
              <div className="chipmore">
                <Select value={/^h[456]$/.test(block) ? block : ("" as BlockKind)} placeholder="4–6" ariaLabel="标题 4 到 6" keepFocus className={"ghost" + (/^h[456]$/.test(block) ? " on" : "")}
                  options={[{ value: "h4", label: "标题 4", hint: kbd("⌘4") }, { value: "h5", label: "标题 5", hint: kbd("⌘5") }, { value: "h6", label: "标题 6", hint: kbd("⌘6") }]}
                  onChange={(k) => { if (v) setBlock(v, k); }} />
              </div>
            </Group>
            <Group label="文字">
              {[...INLINE, ...MORE_INLINE].map((x) => <TB key={x.k} title={x.title} on={active.has(x.k)} onClick={run((y) => toggleInline(y, x.k))}>{x.icon}</TB>)}
              <TB title="链接 ⌘⇧K" onClick={run((x) => insertLink(x))}><Icon name="link" /></TB>
            </Group>
            <Group label="列表与引用">
              <TB title="无序列表 ⌘⇧8" on={block === "ul"} onClick={run((x) => setBlock(x, block === "ul" ? "p" : "ul"))}><Icon name="ul" /></TB>
              <TB title="有序列表 ⌘⇧7" on={block === "ol"} onClick={run((x) => setBlock(x, block === "ol" ? "p" : "ol"))}><Icon name="ol" /></TB>
              <TB title="引用 ⌘⇧." on={block === "quote"} onClick={run((x) => setBlock(x, block === "quote" ? "p" : "quote"))}><Icon name="quote" /></TB>
              <TB title="待办列表 ⌘⇧9" on={block === "task"} onClick={run((x) => setBlock(x, block === "task" ? "p" : "task"))}><Icon name="task" /></TB>
              <span className="vsep" />
              <TB title="减少缩进（回到上一级） ⌘[" disabled={!isList} onClick={run((x) => indentList(x, -1))}><Icon name="outdent" /></TB>
              <TB title="增加缩进（变成上一项的子项） ⌘]" disabled={!isList} onClick={run((x) => indentList(x, 1))}><Icon name="indent" /></TB>
            </Group>
            <Group label="整理">
              <button type="button" className="rb tall" title="中文排版整理：标点、空格、引号（选中的文字或全文）" aria-label="中文排版整理" onMouseDown={keep}
                onClick={(e) => onTidy(e.currentTarget)}><Icon name="typography" size={18} /><span>排版整理</span></button>
            </Group>
          </>}
          {tab === "insert" && <>
            <Group label="块">
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
            </Group>
            <Group label="引用与链接">{big("cite", "文件链接", "插入文件链接 ⌘⇧C", onCite)}{big("link", "链接", "插入链接 ⌘⇧K", run((x) => insertLink(x)))}</Group>
            <Group label="审阅">{big("note", "批注", "给选中文字加批注 ⌘⌥M", run((x) => insertNote(x, author)))}</Group>
          </>}
          {tab === "layout" && <>
            <Group label="字体" className="stack">
              <label className="rfield"><span>标题</span><FontSelect value={layout["heading-font"] || ""} fonts={fonts} allowDefault defaultLabel={`默认（${displayFont(settings.headingFont, fonts)}）`} ariaLabel="本文标题字体" onChange={(f) => onLayout({ ...layout, "heading-font": f })} /></label>
              <label className="rfield"><span>正文</span><FontSelect value={layout["body-font"] || ""} fonts={fonts} allowDefault defaultLabel={`默认（${displayFont(settings.bodyFont, fonts)}）`} ariaLabel="本文正文字体" onChange={(f) => onLayout({ ...layout, "body-font": f })} /></label>
            </Group>
            <Group label="排版">
              {num("font-size", "字号", String(settings.fontSize), { min: 12, max: 28 })}
              {num("line-height", "行距", String(settings.lineHeight), { min: 1.2, max: 2.6, step: 0.05 })}
              {num("measure", "版心", String(settings.measure), { min: 24, max: 60 }, "字")}
            </Group>
            <Group label={hasLayout ? "只对这一篇生效" : "跟随默认设置"} className="reset">
              <TB title="恢复默认：去掉这一篇单独的版式" disabled={!hasLayout} onClick={() => onLayout({})}><Icon name="reset" /></TB>
            </Group>
          </>}
        </div>
      </div>
    </div>
  );
}

export function displayFont(name: string, fonts: FontFamily[]) {
  return fonts.find((f) => f.name === name)?.display || name;
}
