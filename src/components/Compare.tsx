import { useMemo, useState } from "react";
import { alignBlocks, countWords, Op } from "../lib/markdown";
import type { VersionMeta } from "../lib/backend";
import { fmtTime, versionTitle } from "./SidePanel";
import { Icon } from "./Icons";
import { Segmented } from "./Segmented";

interface Props {
  version: VersionMeta;
  oldText: string;
  newText: string;
  against: "current" | "prev";
  hasPrev: boolean;
  prevLabel: string;
  onAgainst: (a: "current" | "prev") => void;
  onClose: () => void;
  onRestore: () => void;
}

/** 整篇对照：左边是那个版本，右边是现在（或下一个版本），逐块对齐，红删绿增 */
export function Compare({ version, oldText, newText, against, hasPrev, prevLabel, onAgainst, onClose, onRestore }: Props) {
  const [mode, setMode] = useState<"side" | "merge">("side");
  const rows = useMemo(() => alignBlocks(oldText, newText), [oldText, newText]);
  const stats = useMemo(() => {
    let changed = 0, plus = 0, minus = 0;
    rows.forEach((r) => { if (r.ops) { changed++; r.ops.forEach(([t, s]) => { if (t === "+") plus += countWords(s, false); if (t === "-") minus += countWords(s, false); }); } });
    return { changed, plus, minus };
  }, [rows]);
  const t = fmtTime(version.at);
  const title = `${versionTitle(version)} · ${t.day} ${t.hm}`;
  const leftLabel = against === "prev" ? prevLabel : title;
  const rightLabel = against === "prev" ? title : "现在";
  const cls = (s: string | null) => (!s ? "" : /^```|^\$\$|^\|/.test(s) ? " mono" : /^#{1,6} /.test(s) ? " h" : "");
  const render = (ops: Op[], side: "-" | "+" | "both") =>
    ops.map(([k, s], i) => k === "=" ? <span key={i}>{s}</span> : k === "-" ? (side !== "+" ? <del key={i}>{s}</del> : null) : (side !== "-" ? <ins key={i}>{s}</ins> : null));

  return (
    <div className="cmp">
      <div className="cmp-h">
        <button className="ib" onClick={onClose} title="返回编辑 Esc"><Icon name="back" />返回编辑</button>
        <div className="ttl"><b>{title}</b><small>{against === "prev" ? "与上一个版本相比" : "与现在相比"}：{stats.changed} 处改动 · <span className="p">+{stats.plus}</span> <span className="m">−{stats.minus}</span> 字{version.note ? ` · ${version.note}` : ""}</small></div>
        <Segmented label="显示方式" value={mode} options={[["side", "并排"], ["merge", "合并"]]} onChange={setMode} />
        {hasPrev && <Segmented label="对比对象" value={against} options={[["current", "对比现在"], ["prev", "对比上一版"]]} onChange={onAgainst} />}
        <button className="btn" onClick={onRestore}>恢复到这个版本</button>
      </div>
      <div className="cmp-b">
        <div className={"cmp-grid" + (mode === "merge" ? " merged" : "")}>
          {mode === "side" ? <><div className="cmp-col-h">{leftLabel}</div><div className="cmp-col-h">{rightLabel}</div></> : <div className="cmp-col-h">{leftLabel} → {rightLabel}</div>}
          {rows.map((r, i) => {
            if (mode === "merge") return <div key={i} className={"cell" + (r.ops ? " ch" : "") + cls(r.right ?? r.left)}>{r.ops ? render(r.ops, "both") : r.right}</div>;
            if (!r.ops) return [<div key={i + "l"} className={"cell" + cls(r.left)}>{r.left}</div>, <div key={i + "r"} className={"cell" + cls(r.right)}>{r.right}</div>];
            return [
              <div key={i + "l"} className={"cell" + (r.left === null ? " empty" : r.right === null ? " gone" : " ch") + cls(r.left)}>{r.left !== null && render(r.ops, "-")}</div>,
              <div key={i + "r"} className={"cell" + (r.right === null ? " empty" : r.left === null ? " new" : " ch") + cls(r.right)}>{r.right !== null && render(r.ops, "+")}</div>,
            ];
          })}
        </div>
      </div>
    </div>
  );
}
