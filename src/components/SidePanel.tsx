import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from "react";
import type { Heading, Note } from "../lib/markdown";
import type { VersionMeta } from "../lib/backend";
import { fmtNoteDate } from "../editor/notes";
import { Icon } from "./Icons";
import { changeTitle, useVersionStats } from "./versionStats";
import { kbd } from "../lib/platform";
import { hasChildren, hiddenByCollapse, outlineKeys } from "../lib/outlineFold";

export type PanelTab = "outline" | "notes" | "versions";
const SRC = { saved: "你保存的", external: "外部修改", auto: "自动" } as const;

export function fmtTime(at: number) {
  const d = new Date(at), now = new Date();
  const hm = `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
  const sameDay = d.toDateString() === now.toDateString();
  return { day: sameDay ? "今天" : `${d.getMonth() + 1}月${d.getDate()}日`, hm };
}
export const versionTitle = (v: VersionMeta) => (v.source === "saved" && v.name ? v.name : SRC[v.source]);

interface Props {
  tab: PanelTab;
  setTab: (t: PanelTab) => void;
  headings: Heading[];
  currentHeading: number;
  notes: Note[];
  versions: VersionMeta[];
  freshVersion: string | null;
  selectedVersion: string | null;
  fileName: string;
  onJump: (pos: number) => void;
  onResolve: (n: Note) => void;
  onOpenVersion: (id: string) => void;
  onSaveVersion: () => void;
  onCompareFile: () => void;
  /** 光标位置：光标落在哪条批注里，那条在列表里标出来 */
  cursorPos?: number;
  /** 当前文稿路径和读取版本内容（算每个版本改了几段） */
  path: string;
  readVersion: (path: string, id: string) => Promise<string>;
  /** 空状态里的操作 */
  onAddHeading?: () => void;
  onAddNote?: () => void;
  /** 这次打开以来有修改：可以一键撤销 */
  canRevert?: boolean;
  onRevert?: () => void;
  /** 目录里拖动标题（N8）：把 from 这个标题的整节挪到 before 这个标题前面（null 是挪到最后） */
  onMoveHeading?: (from: number, before: number | null) => void;
}

/**
 * 错峰出场：一组列表刚出现（换到这一栏、换了文件）时，当时就在的条目一条接一条进来。
 * 之后新增的条目不参与，平时打字重绘也不会重播。
 */
function useStagger(group: string) {
  const r = useRef<{ group: string | null; open: boolean; keys: Map<string, number> }>({ group: null, open: false, keys: new Map() });
  if (r.current.group !== group) r.current = { group, open: true, keys: new Map() };
  useEffect(() => { r.current.open = false; });
  return (key: string): { cls: string; style?: CSSProperties } => {
    const m = r.current.keys;
    if (r.current.open && !m.has(key)) m.set(key, m.size);
    const i = m.get(key);
    return i === undefined ? { cls: "" } : { cls: " stg", style: { "--i": i } as CSSProperties };
  };
}

export function SidePanel(p: Props) {
  const tabs = useRef<HTMLDivElement>(null);
  const stagger = useStagger(p.tab + "|" + p.fileName);
  const [ink, setInk] = useState({ x: 0, w: 0 });
  useLayoutEffect(() => {
    const el = tabs.current?.querySelector<HTMLElement>(".tab.active");
    if (el) setInk({ x: el.offsetLeft + 8, w: el.offsetWidth - 16 });
  }, [p.tab, p.notes.length, p.freshVersion]);
  const noteCounts = countNotesPerHeading(p.headings, p.notes);
  const outlineRef = useRef<HTMLDivElement>(null);
  // 目录自己的折叠（和正文的折叠各管各的）
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const okeys = outlineKeys(p.headings), kids = hasChildren(p.headings), hidden = hiddenByCollapse(p.headings, okeys, collapsed);
  const toggleKids = (k: string) => setCollapsed((c) => { const n = new Set(c); if (n.has(k)) n.delete(k); else n.add(k); return n; });
  useEffect(() => { outlineRef.current?.querySelector(".oi.cur")?.scrollIntoView({ block: "nearest", behavior: "smooth" }); }, [p.currentHeading]);

  /* 目录里拖动标题：整节一起移动。按住拖过 4px 才算拖动，否则就是点击跳转 */
  const [dropY, setDropY] = useState<number | null>(null);
  const dragged = useRef(false);
  const startDrag = (e: React.MouseEvent, i: number) => {
    if (e.button !== 0 || !p.onMoveHeading || !outlineRef.current) return;
    const box = outlineRef.current, hs = p.headings, L = hs[i].level;
    let end = i + 1;
    while (end < hs.length && hs[end].level > L) end++; // 自己这一节：i .. end-1
    const x0 = e.clientX, y0 = e.clientY;
    let on = false, before: number | null | undefined;
    const mv = (ev: MouseEvent) => {
      if (!on && Math.hypot(ev.clientX - x0, ev.clientY - y0) < 4) return;
      if (!on) { on = true; document.body.classList.add("hm-dragging"); }
      const rows = [...box.querySelectorAll<HTMLElement>(".oi[data-i]")];
      const top = box.getBoundingClientRect().top - box.scrollTop;
      const hit = rows.find((r) => { const b = r.getBoundingClientRect(); return ev.clientY < b.top + b.height / 2; });
      const k = hit ? +hit.dataset.i! : null;
      if (k !== null && k >= i && k < end) { before = undefined; setDropY(null); return; } // 放在自己这一节里面
      if (k === end || (k === null && end >= hs.length)) { before = undefined; setDropY(null); return; } // 原地
      before = k;
      const y = hit ? hit.getBoundingClientRect().top : rows[rows.length - 1].getBoundingClientRect().bottom;
      setDropY(Math.round(y - top));
    };
    const up = () => {
      removeEventListener("mousemove", mv); removeEventListener("mouseup", up);
      document.body.classList.remove("hm-dragging");
      setDropY(null);
      if (!on) return;
      dragged.current = true;
      setTimeout(() => { dragged.current = false; }, 0);
      if (before !== undefined) p.onMoveHeading!(hs[i].pos, before === null ? null : hs[before].pos);
    };
    addEventListener("mousemove", mv); addEventListener("mouseup", up);
  };

  return (
    <div className="panel-in">
      <div className="tabs" role="tablist" ref={tabs}>
        <button role="tab" aria-selected={p.tab === "outline"} className={"tab" + (p.tab === "outline" ? " active" : "")} onClick={() => p.setTab("outline")}>目录</button>
        <button role="tab" aria-selected={p.tab === "notes"} className={"tab" + (p.tab === "notes" ? " active" : "")} onClick={() => p.setTab("notes")}>批注{p.notes.length > 0 && <span className="badge">{p.notes.length}</span>}</button>
        <button role="tab" aria-selected={p.tab === "versions"} className={"tab" + (p.tab === "versions" ? " active" : "")} onClick={() => p.setTab("versions")}>版本{p.freshVersion && <span className="dotn" />}</button>
        <span className="ink" style={{ transform: `translateX(${ink.x}px)`, width: ink.w }} />
      </div>

      {p.tab === "outline" && (
        <div className="pane">
          {p.headings.length ? (
            <div className="ol" ref={outlineRef}>
              {p.headings.map((h, i) => hidden[i] ? null : (
                // 每一级都缩进（一级和二级以前一样靠左）；截断的长标题悬停能看到全文；有子级的标题可以收起（N6）
                <button key={i} data-i={i} className={"oi l" + Math.min(h.level, 4) + (i === p.currentHeading ? " cur" : "")} style={{ "--lv": Math.max(0, h.level - 1) } as React.CSSProperties}
                  onMouseDown={(e) => startDrag(e, i)} onClick={() => { if (!dragged.current) p.onJump(h.pos); }} title={h.text}>
                  {kids[i] && <span className={"ofold" + (collapsed.has(okeys[i]) ? " shut" : "")} role="button" aria-label={collapsed.has(okeys[i]) ? "展开子级" : "收起子级"}
                    onClick={(e) => { e.stopPropagation(); toggleKids(okeys[i]); }}><Icon name="chev" size={12} /></span>}
                  <span className="t">{h.text}</span>
                  {noteCounts[i] > 0 && <span className="cm" title={`${noteCounts[i]} 条批注`}>{noteCounts[i]}</span>}
                </button>
              ))}
              {dropY !== null && <div className="ol-drop" style={{ top: dropY }} aria-hidden="true" />}
            </div>
          ) : <Empty icon="outline" text="这篇还没有标题。加上标题，这里就会列出目录。" action={p.onAddHeading && { label: "把这一段设成标题", run: p.onAddHeading }} />}
        </div>
      )}

      {p.tab === "notes" && (
        <div className="pane">
          {p.notes.length ? <div className="nl">{p.notes.map((n) => {
            const st = stagger(String(n.at));
            const cur = p.cursorPos !== undefined && p.cursorPos >= n.at && p.cursorPos <= n.at + n.length;
            return (
              <div key={n.at} className={"ni" + (cur ? " cur" : "") + st.cls} style={st.style} onClick={() => p.onJump(n.at + 3)}>
                <div className="q">{n.quote}</div>
                <div className={"tx" + (n.text ? "" : " ph2")}>{n.text || "还没有写内容"}</div>
                <div className="by"><span className="who">{n.who || "未署名"}</span><span className="dt">{fmtNoteDate(n.date)}</span>
                  <button className="ok" onClick={(e) => { e.stopPropagation(); p.onResolve(n); }}>解决</button></div>
              </div>
            );
          })}</div> : <Empty icon="note" text="还没有批注。选中一段文字，就能在旁边写批注。" action={p.onAddNote && { label: "给选中的文字加批注", run: p.onAddNote }} />}
        </div>
      )}

      {p.tab === "versions" && (
        <div className="pane">
          {/* 头部只留两个操作（文件名和标题栏重复，去掉）；来源的图例给一次 */}
          <div className="ph">
            <button className="lnk" onClick={p.onSaveVersion} title={kbd("⌘S 直接存档，不用起名字")}>保存版本…</button>
            <button className="lnk" onClick={p.onCompareFile} title="选一篇文稿和当前文稿左右对比">与其他文稿对比</button>
          </div>
          {p.canRevert && <button className="vrevert" onClick={p.onRevert}><Icon name="reset" size={14} />撤销这次打开以来的修改</button>}
          {p.versions.length ? <VersionList {...p} /> : <Empty icon="history" text="还没有版本。自动保存的同时会定时留一个版本，也可以随时自己存一个。" action={{ label: "保存一个版本", run: p.onSaveVersion }} />}
        </div>
      )}
    </div>
  );
}

/** 空状态：一个小图标、一句话、一个操作 */
function Empty({ icon, text, action }: { icon: string; text: string; action?: { label: string; run: () => void } | false }) {
  return (
    <div className="empty">
      <span className="em-ic"><Icon name={icon} size={18} /></span>
      <p>{text}</p>
      {action && <button className="btn sm" onClick={action.run}>{action.label}</button>}
    </div>
  );
}

function VersionList(p: Props) {
  const stagger = useStagger(p.fileName);
  const [mine, setMine] = useState(false);
  const stat = useVersionStats(p.path, p.versions, p.readVersion);
  // 记住已经显示过的版本，新出现的从上方滑入
  const seen = useRef<Set<string> | null>(null);
  const fresh = new Set<string>();
  if (seen.current === null) seen.current = new Set(p.versions.map((v) => v.id));
  else p.versions.forEach((v) => { if (!seen.current!.has(v.id)) fresh.add(v.id); });
  useEffect(() => { p.versions.forEach((v) => seen.current!.add(v.id)); });
  // 同一分钟里有好几个版本时，时间写到秒，免得分不清
  const minute = (at: number) => Math.floor(at / 60000);
  const dupMinute = new Set<number>();
  p.versions.forEach((v, i) => { if (i && minute(p.versions[i - 1].at) === minute(v.at)) { dupMinute.add(minute(v.at)); } });
  let day = "";
  return <>
    <div className="vbar">
      <span className="vlegend"><i className="saved" />你保存的<i className="external" />外部修改<i className="auto" />自动</span>
      <label className="vfilter"><input type="checkbox" checked={mine} onChange={(e) => setMine(e.target.checked)} />只看我保存的</label>
    </div>
    {p.versions.map((v, i) => {
      if (mine && v.source !== "saved") return null;
      const t = fmtTime(v.at);
      const head = t.day !== day ? <div className="vgrp">{(day = t.day)}</div> : null;
      const st = stagger(v.id);
      const named = v.source === "saved" && v.name;
      const sec = dupMinute.has(minute(v.at)) ? ":" + String(new Date(v.at).getSeconds()).padStart(2, "0") : "";
      return (
        <div key={v.id}>
          {head}
          <button className={`ver ${v.source}` + (v.id === p.selectedVersion ? " sel" : "") + (fresh.has(v.id) ? " enter" : st.cls)} style={st.style} onClick={() => p.onOpenVersion(v.id)} title={SRC[v.source]}>
            <span className="nd" aria-label={SRC[v.source]} />
            <span className="vb">
              <span className="nm">{named ? v.name : changeTitle(stat(i)) || "…"}</span>
              {v.note && <span className="note">{v.note}</span>}
            </span>
            <span className="tm">{t.hm}{sec}</span>
            {v.id === p.freshVersion && <span className="nw">新</span>}
          </button>
        </div>
      );
    })}
  </>;
}

function countNotesPerHeading(hs: Heading[], notes: Note[]) {
  return hs.map((h, i) => {
    const end = hs.slice(i + 1).find((x) => x.level <= Math.max(h.level, 2))?.pos ?? Infinity;
    const start = h.pos;
    return h.level === 1 ? 0 : notes.filter((n) => n.at >= start && n.at < end).length;
  });
}

/** 让外层可以监听 ESC 等按键时把焦点还给编辑器 */
export function useEsc(cb: () => void) {
  useEffect(() => {
    const f = (e: KeyboardEvent) => { if (e.key === "Escape") cb(); };
    addEventListener("keydown", f);
    return () => removeEventListener("keydown", f);
  }, [cb]);
}
