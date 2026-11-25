import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { Heading, Note } from "../lib/markdown";
import type { VersionMeta } from "../lib/backend";
import { Icon } from "./Icons";

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
}

export function SidePanel(p: Props) {
  const tabs = useRef<HTMLDivElement>(null);
  const [ink, setInk] = useState({ x: 0, w: 0 });
  useLayoutEffect(() => {
    const el = tabs.current?.querySelector<HTMLElement>(".tab.active");
    if (el) setInk({ x: el.offsetLeft + 8, w: el.offsetWidth - 16 });
  }, [p.tab, p.notes.length, p.freshVersion]);
  const noteCounts = countNotesPerHeading(p.headings, p.notes);
  const outlineRef = useRef<HTMLDivElement>(null);
  useEffect(() => { outlineRef.current?.querySelector(".oi.cur")?.scrollIntoView({ block: "nearest", behavior: "smooth" }); }, [p.currentHeading]);

  return (
    <div className="panel-in">
      <div className="tabs" role="tablist" ref={tabs}>
        <button role="tab" aria-selected={p.tab === "outline"} className={"tab" + (p.tab === "outline" ? " active" : "")} onClick={() => p.setTab("outline")}>大纲</button>
        <button role="tab" aria-selected={p.tab === "notes"} className={"tab" + (p.tab === "notes" ? " active" : "")} onClick={() => p.setTab("notes")}>批注{p.notes.length > 0 && <span className="badge">{p.notes.length}</span>}</button>
        <button role="tab" aria-selected={p.tab === "versions"} className={"tab" + (p.tab === "versions" ? " active" : "")} onClick={() => p.setTab("versions")}>版本{p.freshVersion && <span className="dotn" />}</button>
        <span className="ink" style={{ transform: `translateX(${ink.x}px)`, width: ink.w }} />
      </div>

      {p.tab === "outline" && (
        <div className="pane">
          {p.headings.length ? (
            <div className="ol" ref={outlineRef}>
              {p.headings.map((h, i) => (
                <button key={i} className={"oi" + (h.level === 1 ? " l1" : "") + (i === p.currentHeading ? " cur" : "")} style={{ "--lv": Math.max(0, h.level - 2) } as React.CSSProperties} onClick={() => p.onJump(h.pos)}>
                  <span className="t">{h.text}</span>
                  {noteCounts[i] > 0 && <span className="cm"><Icon name="note" size={12} />{noteCounts[i]}</span>}
                </button>
              ))}
            </div>
          ) : <div className="empty">这个文件还没有标题<br />用 # 开头的行会出现在这里</div>}
        </div>
      )}

      {p.tab === "notes" && (
        <div className="pane">
          {p.notes.length ? p.notes.map((n) => (
            <div key={n.at} className="cc" onClick={() => p.onJump(n.at + 3)}>
              <div className="who"><span className="av" style={{ background: avatarColor(n.who) }}>{(n.who || "?").slice(0, 1)}</span><b>{n.who || "未署名"}</b><span>{n.date}</span></div>
              <div className="q">{n.quote}</div>
              <div className={"tx" + (n.text ? "" : " ph2")}>{n.text || "正在正文里输入…"}</div>
              <div className="acts"><button className="btn sm" onClick={(e) => { e.stopPropagation(); p.onResolve(n); }}>解决</button></div>
            </div>
          )) : <div className="empty">没有批注<br />选中文字后点工具栏里的「批注」</div>}
        </div>
      )}

      {p.tab === "versions" && (
        <div className="pane">
          <div className="ph"><b>{p.fileName}</b><button className="lnk" onClick={p.onSaveVersion}>保存版本 ⌘S</button></div>
          {p.versions.length ? <VersionList {...p} /> : <div className="empty">还没有版本<br />按 ⌘S 保存第一个</div>}
        </div>
      )}
    </div>
  );
}

function VersionList(p: Props) {
  // 记住已经显示过的版本，新出现的从上方滑入
  const seen = useRef<Set<string> | null>(null);
  const fresh = new Set<string>();
  if (seen.current === null) seen.current = new Set(p.versions.map((v) => v.id));
  else p.versions.forEach((v) => { if (!seen.current!.has(v.id)) fresh.add(v.id); });
  useEffect(() => { p.versions.forEach((v) => seen.current!.add(v.id)); });
  let day = "";
  return <>{p.versions.map((v) => {
    const t = fmtTime(v.at);
    const head = t.day !== day ? <div className="vgrp">{(day = t.day)}</div> : null;
    return (
      <div key={v.id}>
        {head}
        <button className={`ver ${v.source}` + (v.id === p.selectedVersion ? " sel" : "") + (fresh.has(v.id) ? " enter" : "")} onClick={() => p.onOpenVersion(v.id)}>
          <span className="nd" />
          <span><div className="nm">{versionTitle(v)}</div><div className="tm">{t.hm} · {SRC[v.source]}{v.note ? ` · ${v.note}` : ""}</div></span>
          {v.id === p.freshVersion && <span className="nw">新</span>}
        </button>
      </div>
    );
  })}</>;
}

function countNotesPerHeading(hs: Heading[], notes: Note[]) {
  return hs.map((h, i) => {
    const end = hs.slice(i + 1).find((x) => x.level <= Math.max(h.level, 2))?.pos ?? Infinity;
    const start = h.pos;
    return h.level === 1 ? 0 : notes.filter((n) => n.at >= start && n.at < end).length;
  });
}

export function avatarColor(who: string) {
  if (who === "我") return "#5A62DE";
  let h = 0;
  for (const c of who) h = (h * 31 + c.charCodeAt(0)) % 360;
  return `hsl(${h} 55% 45%)`;
}

/** 让外层可以监听 ESC 等按键时把焦点还给编辑器 */
export function useEsc(cb: () => void) {
  useEffect(() => {
    const f = (e: KeyboardEvent) => { if (e.key === "Escape") cb(); };
    addEventListener("keydown", f);
    return () => removeEventListener("keydown", f);
  }, [cb]);
}
