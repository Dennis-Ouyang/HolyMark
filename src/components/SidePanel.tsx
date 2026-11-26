import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from "react";
import type { Heading, Note } from "../lib/markdown";
import type { VersionMeta } from "../lib/backend";
import { fmtNoteDate } from "../editor/notes";
import { kbd } from "../lib/platform";

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
  useEffect(() => { outlineRef.current?.querySelector(".oi.cur")?.scrollIntoView({ block: "nearest", behavior: "smooth" }); }, [p.currentHeading]);

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
              {p.headings.map((h, i) => (
                <button key={i} className={"oi" + (h.level === 1 ? " l1" : "") + (i === p.currentHeading ? " cur" : "")} style={{ "--lv": Math.max(0, h.level - 2) } as React.CSSProperties} onClick={() => p.onJump(h.pos)}>
                  <span className="t">{h.text}</span>
                  {noteCounts[i] > 0 && <span className="cm" title={`${noteCounts[i]} 条批注`}>{noteCounts[i]}</span>}
                </button>
              ))}
            </div>
          ) : <div className="empty">这个文档没有 Markdown 语法的目录</div>}
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
          })}</div> : <div className="empty">这个文档还没有批注<br />选择一段文字来添加批注</div>}
        </div>
      )}

      {p.tab === "versions" && (
        <div className="pane">
          <div className="ph"><b>{p.fileName}</b><span><button className="lnk" onClick={p.onCompareFile} title="选一篇文稿和当前文稿左右对比">与其他文稿对比</button><button className="lnk" onClick={p.onSaveVersion}>{kbd("保存版本 ⌘S")}</button></span></div>
          {p.versions.length ? <VersionList {...p} /> : <div className="empty">这个文档还没有版本</div>}
        </div>
      )}
    </div>
  );
}

function VersionList(p: Props) {
  const stagger = useStagger(p.fileName);
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
    const st = stagger(v.id);
    return (
      <div key={v.id}>
        {head}
        <button className={`ver ${v.source}` + (v.id === p.selectedVersion ? " sel" : "") + (fresh.has(v.id) ? " enter" : st.cls)} style={st.style} onClick={() => p.onOpenVersion(v.id)}>
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

/** 让外层可以监听 ESC 等按键时把焦点还给编辑器 */
export function useEsc(cb: () => void) {
  useEffect(() => {
    const f = (e: KeyboardEvent) => { if (e.key === "Escape") cb(); };
    addEventListener("keydown", f);
    return () => removeEventListener("keydown", f);
  }, [cb]);
}
