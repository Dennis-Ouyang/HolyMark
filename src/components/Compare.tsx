import { useMemo, useState } from "react";
import { alignBlocks, countWords, Op } from "../lib/markdown";
import type { VersionMeta } from "../lib/backend";
import { fmtTime, versionTitle } from "./SidePanel";
import { Icon } from "./Icons";
import { Segmented } from "./Segmented";

interface Props {
  version?: VersionMeta;
  /** 和另一个文件对比时，那个文件的名字（这时没有版本、不能恢复） */
  fileLabel?: string;
  onPick?: () => void;
  oldText: string;
  newText: string;
  against: "current" | "prev";
  /** 这个版本和现在的内容一样 */
  sameAsNow?: boolean;
  hasPrev: boolean;
  prevLabel: string;
  onAgainst: (a: "current" | "prev") => void;
  onClose: () => void;
  onRestore: () => void;
}

/** 整篇对照：左边是那个版本，右边是现在（或下一个版本），逐块对齐，红删绿增 */
export function Compare({ version, fileLabel, onPick, oldText, newText, against, sameAsNow, hasPrev, prevLabel, onAgainst, onClose, onRestore }: Props) {
  const [mode, setMode] = useState<"side" | "merge">("side");
  const rows = useMemo(() => alignBlocks(oldText, newText), [oldText, newText]);
  const stats = useMemo(() => {
    let changed = 0, plus = 0, minus = 0;
    rows.forEach((r) => { if (r.ops) { changed++; r.ops.forEach(([t, s]) => { if (t === "+") plus += countWords(s, false); if (t === "-") minus += countWords(s, false); }); } });
    return { changed, plus, minus };
  }, [rows]);
  const t = version ? fmtTime(version.at) : null;
  const name = fileLabel ? fileLabel : versionTitle(version!);
  const title = fileLabel ? fileLabel : `${name} ${t!.day} ${t!.hm}`;
  const leftLabel = against === "prev" ? prevLabel : title;
  const rightLabel = against === "prev" ? title : "现在";
  const against0 = fileLabel ? "左边是那个文件，右边是现在" : against === "prev" ? "与上一版相比" : "与现在相比";
  const cls = (s: string | null) => (!s ? "" : /^```|^\$\$|^\|/.test(s) ? " mono" : /^#{1,6} /.test(s) ? " h" : "");
  const render = (ops: Op[], side: "-" | "+" | "both") =>
    ops.map(([k, s], i) => k === "=" ? <span key={i}>{s}</span> : k === "-" ? (side !== "+" ? <del key={i}>{s}</del> : null) : (side !== "-" ? <ins key={i}>{s}</ins> : null));

  return (
    <div className="cmp">
      <div className="cmp-h">
        <button className="ib" onClick={onClose} title="返回编辑 Esc"><Icon name="back" />返回编辑</button>
        {/* 标题和时间分成两个元素；标题单行截断，右边的按钮不会被挤到第二行 */}
        <div className="ttl">
          <div className="tl"><b title={name}>{fileLabel ? `「${fileLabel}」和当前文稿` : name}</b>{t && <span className="tm">{t.day} {t.hm}</span>}</div>
          <div className="sub">
            {sameAsNow && <span className="same">和现在一样</span>}
            {sameAsNow && against === "current" ? <span>没有更早的版本可以对比</span> : <>
              <span>{against0}</span>
              <span className="n">{stats.changed} 处不同</span>
              {stats.plus > 0 && <span className="p">+{stats.plus}</span>}
              {stats.minus > 0 && <span className="m">−{stats.minus}</span>}
            </>}
          </div>
          {version?.note && <div className="note" title={version.note}>{version.note}</div>}
        </div>
        <Segmented label="显示方式" value={mode} options={[["side", "并排"], ["merge", "合并"]]} onChange={setMode} />
        {hasPrev && !fileLabel && <Segmented label="对比对象" value={against} options={[["current", "对比现在"], ["prev", "对比上一版"]]} onChange={onAgainst} />}
        {fileLabel ? onPick && <button className="btn" onClick={onPick}>换一个文件…</button> : <button className="btn" onClick={onRestore}>恢复到这个版本</button>}
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
