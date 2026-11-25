import { useEffect, useRef, useState } from "react";
import type { EditorView } from "@codemirror/view";
import { BlockKind, currentBlock, insertBlock, insertLink, insertNote, setBlock, tableMarkdown, toggleInline } from "../editor/commands";
import { Icon } from "./Icons";
import { FONT_SUGGESTIONS, Settings } from "../lib/settings";

const BLOCKS: [BlockKind, string][] = [["p", "正文"], ["h1", "标题 1"], ["h2", "标题 2"], ["h3", "标题 3"], ["quote", "引用"], ["ul", "无序列表"], ["ol", "有序列表"], ["task", "任务列表"]];
const keep = (e: React.MouseEvent) => e.preventDefault(); // 点按钮不让编辑器失去选区

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
    const host = view.dom.closest(".main")!.getBoundingClientRect();
    if (!a || !b) { setPos(null); return; }
    const w = ref.current?.offsetWidth || 400;
    const mid = (Math.min(a.left, b.left) + Math.max(a.right, b.right)) / 2 - host.left;
    let top = Math.min(a.top, b.top) - host.top - 46;
    if (top < 4) top = Math.max(a.bottom, b.bottom) - host.top + 8;
    setPos({ left: Math.min(Math.max(w / 2 + 8, mid), host.width - w / 2 - 8), top });
    setKind(currentBlock(view));
  }, [view, tick]);
  if (!pos || !view) return null;
  return (
    <div className="ftb" ref={ref} style={{ left: pos.left, top: pos.top }} role="toolbar" aria-label="格式" onMouseDown={(e) => { if ((e.target as HTMLElement).tagName !== "SELECT") keep(e); }}>
      <select aria-label="段落类型" value={kind} onChange={(e) => setBlock(view, e.target.value as BlockKind)}>
        {BLOCKS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
      </select>
      <span className="sep" />
      <button className="rb" title="粗体 ⌘B" aria-label="粗体" onClick={() => toggleInline(view, "bold")}><b>B</b></button>
      <button className="rb" title="斜体 ⌘I" aria-label="斜体" onClick={() => toggleInline(view, "italic")}><i className="serif-i">I</i></button>
      <button className="rb" title="删除线" aria-label="删除线" onClick={() => toggleInline(view, "strike")}><s>S</s></button>
      <button className="rb" title="行内代码 ⌘E" aria-label="行内代码" onClick={() => toggleInline(view, "code")}><Icon name="code" /></button>
      <button className="rb" title="行内公式" aria-label="行内公式" onClick={() => toggleInline(view, "math")}><Icon name="math" /></button>
      <button className="rb" title="链接" aria-label="链接" onClick={() => insertLink(view)}><Icon name="link" /></button>
      <span className="sep" />
      <button className="rb" title="批注" onClick={() => insertNote(view, author)}><Icon name="note" /><span>批注</span></button>
    </div>
  );
}

/* ---------------- 顶部功能区 ---------------- */
interface RibbonProps {
  view: EditorView | null;
  author: string;
  settings: Settings;
  layout: Record<string, string>;
  onLayout: (l: Record<string, string>) => void;
  onSaveVersion: () => void;
  onPickImage: () => void;
  onCite: () => void;
}

export function Ribbon({ view, author, settings, layout, onLayout, onSaveVersion, onPickImage, onCite }: RibbonProps) {
  const [tab, setTab] = useState<"home" | "insert" | "layout">("home");
  const [collapsed, setCollapsed] = useState(() => localStorage.getItem("holymark-ribbon") === "collapsed");
  const [grid, setGrid] = useState<{ r: number; c: number } | null>(null);
  const [gridOpen, setGridOpen] = useState(false);
  useEffect(() => { try { localStorage.setItem("holymark-ribbon", collapsed ? "collapsed" : "open"); } catch { /* ignore */ } }, [collapsed]);
  const v = view;
  const btn = (icon: string, label: string, title: string, run: () => void, tall = false) => (
    <button className={"rb" + (tall ? " tall" : "")} title={title} aria-label={title} onMouseDown={keep} onClick={() => v && run()}>
      <Icon name={icon} size={tall ? 18 : 15} />{label && <span>{label}</span>}
    </button>
  );
  const field = (k: string, label: string, ph: string, type: "font" | "num", extra?: React.InputHTMLAttributes<HTMLInputElement>) => (
    <label className="rfield">{label}
      <input key={k + (layout[k] || "")} className={type === "font" ? "font" : "n"} list={type === "font" ? "hm-fonts" : undefined} type={type === "num" ? "number" : "text"}
        defaultValue={layout[k] || ""} placeholder={ph} {...extra}
        onBlur={(e) => { const val = e.target.value.trim(); if ((layout[k] || "") !== val) onLayout({ ...layout, [k]: val }); }}
        onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }} />
    </label>
  );
  return (
    <div className={"ribbon" + (collapsed ? " collapsed" : "")}>
      <datalist id="hm-fonts">{FONT_SUGGESTIONS.map((f) => <option key={f} value={f} />)}</datalist>
      <div className="rtabs" role="tablist">
        {([["home", "开始"], ["insert", "插入"], ["layout", "本文版式"]] as const).map(([k, l]) => (
          <button key={k} role="tab" aria-selected={tab === k} className={"rtab" + (tab === k ? " on" : "")} onClick={() => { setTab(k); setCollapsed(false); }}>{l}</button>
        ))}
        <button className="ib collapse" title={collapsed ? "展开功能区" : "折叠功能区"} aria-label="折叠功能区" onClick={() => setCollapsed(!collapsed)}><Icon name="up" /></button>
      </div>
      {!collapsed && (
        <div className="rbody">
          {tab === "home" && <>
            <div className="rgrp"><div className="row">{(["p", "h1", "h2", "h3"] as BlockKind[]).map((k) => <button key={k} className="rb" onMouseDown={keep} onClick={() => v && setBlock(v, k)}>{BLOCKS.find((b) => b[0] === k)![1]}</button>)}</div><span className="gl">段落</span></div>
            <div className="rgrp"><div className="row">
              <button className="rb" title="粗体 ⌘B" aria-label="粗体" onMouseDown={keep} onClick={() => v && toggleInline(v, "bold")}><b>B</b></button>
              <button className="rb" title="斜体 ⌘I" aria-label="斜体" onMouseDown={keep} onClick={() => v && toggleInline(v, "italic")}><i className="serif-i">I</i></button>
              <button className="rb" title="删除线" aria-label="删除线" onMouseDown={keep} onClick={() => v && toggleInline(v, "strike")}><s>S</s></button>
              {btn("code", "", "行内代码 ⌘E", () => toggleInline(v!, "code"))}{btn("math", "", "行内公式", () => toggleInline(v!, "math"))}{btn("link", "", "链接", () => insertLink(v!))}
            </div><span className="gl">文字</span></div>
            <div className="rgrp"><div className="row">{btn("ul", "", "无序列表", () => setBlock(v!, "ul"))}{btn("ol", "", "有序列表", () => setBlock(v!, "ol"))}{btn("task", "", "任务列表", () => setBlock(v!, "task"))}{btn("quote", "", "引用块", () => setBlock(v!, "quote"))}</div><span className="gl">列表与引用</span></div>
            <div className="rgrp"><div className="row">{btn("note", "批注", "给选中文字加批注", () => insertNote(v!, author))}<button className="rb" onMouseDown={keep} onClick={onSaveVersion}>保存版本</button></div><span className="gl">审阅</span></div>
          </>}
          {tab === "insert" && <>
            <div className="rgrp"><div className="row">
              <div className="rb-wrap">
                <button className="rb tall" title="插入表格" onMouseDown={keep} onClick={() => setGridOpen(!gridOpen)}><Icon name="table" size={18} /><span>表格</span></button>
                {gridOpen && (
                  <div className="pop gridpop" onMouseLeave={() => setGrid(null)}>
                    <div className="gridlbl">{grid ? `${grid.r} 行 × ${grid.c} 列` : "选择行列"}</div>
                    <div className="gridpick">{Array.from({ length: 48 }, (_, i) => { const r = Math.floor(i / 8) + 1, c = (i % 8) + 1; return (
                      <i key={i} className={grid && r <= grid.r && c <= grid.c ? "on" : ""} onMouseEnter={() => setGrid({ r, c })} onMouseDown={keep}
                        onClick={() => { setGridOpen(false); v && insertBlock(v, tableMarkdown(r, c), 2); }} />); })}</div>
                  </div>
                )}
              </div>
              {btn("img", "图片", "插入图片", onPickImage, true)}
              {btn("codeb", "代码", "代码块", () => insertBlock(v!, "```python\n\n```", 10), true)}
              {btn("mathb", "公式", "公式块", () => insertBlock(v!, "$$\n\n$$", 3), true)}
              {btn("mermaid", "图表", "Mermaid 图表", () => insertBlock(v!, "```mermaid\nflowchart LR\n  A[开始] --> B[结束]\n```", 11), true)}
              {btn("hr", "分隔线", "分隔线", () => insertBlock(v!, "---"), true)}
            </div><span className="gl">块</span></div>
            <div className="rgrp"><div className="row">{btn("cite", "文献", "插入文献引用", onCite, true)}{btn("link", "链接", "插入链接", () => insertLink(v!), true)}</div><span className="gl">引用</span></div>
          </>}
          {tab === "layout" && <>
            <div className="rgrp"><div className="row">{field("heading-font", "标题", settings.headingFont, "font")}{field("body-font", "正文", settings.bodyFont, "font")}</div><span className="gl">字体</span></div>
            <div className="rgrp"><div className="row">
              {field("font-size", "字号", String(settings.fontSize), "num", { min: 12, max: 28 })}
              {field("line-height", "行距", String(settings.lineHeight), "num", { min: 1.2, max: 2.6, step: 0.05 })}
              {field("measure", "版心", String(settings.measure), "num", { min: 24, max: 60 })}
            </div><span className="gl">排版</span></div>
            <div className="rgrp"><div className="row"><button className="rb" onClick={() => onLayout({})}>清除本文版式</button></div><span className="gl">只对这一篇生效</span></div>
          </>}
        </div>
      )}
    </div>
  );
}
