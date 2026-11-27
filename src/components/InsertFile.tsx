/**
 * 插入（⌘⇧C）：光标处的小浮层，以文件为主。
 * - 打开时：最近用过的文件 + 和本文在同一个文件夹里的文件；
 * - 打字：在整个文件夹里按名字找；
 * - 开头输入 @：改为插入文献引用（文件夹里有 .bib 时）；
 * - 文件夹以外的文件交给系统的文件窗口（最底下一行）。⌘O 在全局是「打开文件夹」，浮层里不再另作他用。
 */
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Icon } from "./Icons";
import { FileBadge } from "./FileBadge";
import type { TreeNode } from "../lib/backend";
import { BibEntry, shortAuthor } from "../lib/bib";
import { baseName, dirOf, relative } from "../lib/paths";
import { CARD_EXT } from "../lib/filePreview";

export type InsertPick = { kind: "file"; path: string } | { kind: "bib"; key: string };
type Row = { kind: "file"; node: TreeNode; dir: string } | { kind: "bib"; b: BibEntry };

const SHOW = 7;
const extOf = (n: string) => (n.includes(".") ? n.split(".").pop()!.toLowerCase() : "");
/** 文件类型的小标签：同色系浅底深字 */
const TYPE: Record<string, string> = { md: "md", markdown: "md", pdf: "pdf", doc: "doc", docx: "doc", xls: "sheet", xlsx: "sheet", csv: "sheet", png: "img", jpg: "img", jpeg: "img", gif: "img", webp: "img", svg: "img" };

interface Props {
  /** 光标的位置（窗口坐标）：浮层从这里长出来 */
  at: { left: number; top: number; bottom: number };
  files: TreeNode[];
  docPath: string;
  root: string;
  bib: BibEntry[];
  recent: string[];
  onPick: (p: InsertPick) => void;
  onPickOther: () => void;
  onClose: () => void;
}

export function InsertFile({ at, files, docPath, root, bib, recent, onPick, onPickOther, onClose }: Props) {
  const [q, setQ] = useState("");
  const [sel, setSel] = useState(0);
  const box = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ left: at.left - 12, top: at.bottom + 6, up: false });
  const others = useMemo(() => files.filter((f) => f.path !== docPath), [files, docPath]);
  const rel = (p: string) => { const d = dirOf(relative(root, p)); return d === "." ? "" : d; };
  const bibMode = q.startsWith("@");
  const qt = (bibMode ? q.slice(1) : q).trim().toLowerCase();

  const view = useMemo(() => {
    if (bibMode) {
      const list = bib.filter((b) => !qt || `${b.key} ${b.author} ${b.year} ${b.title}`.toLowerCase().includes(qt));
      return { groups: [{ title: "文献", rows: list.slice(0, SHOW).map((b) => ({ kind: "bib", b }) as Row) }], more: Math.max(0, list.length - SHOW), total: list.length };
    }
    if (!qt) {
      const byPath = new Map(others.map((f) => [f.path, f]));
      const rec = recent.map((p) => byPath.get(p)).filter(Boolean).slice(0, 3) as TreeNode[];
      const here = dirOf(docPath);
      const near = others.filter((f) => dirOf(f.path) === here && !rec.includes(f)).slice(0, 6);
      return {
        groups: [
          ...(rec.length ? [{ title: "最近用过", rows: rec.map((node) => ({ kind: "file", node, dir: rel(node.path) }) as Row) }] : []),
          { title: "和本文在同一个文件夹", rows: near.map((node) => ({ kind: "file", node, dir: rel(node.path) }) as Row) },
        ], more: 0, total: 0,
      };
    }
    // 名字开头匹配的排前面，其次名字里有，最后是路径里有
    const score = (f: TreeNode) => { const n = f.name.toLowerCase(); return n.startsWith(qt) ? 0 : n.includes(qt) ? 1 : relative(root, f.path).toLowerCase().includes(qt) ? 2 : 9; };
    const list = others.map((f) => [score(f), f] as const).filter(([s]) => s < 9).sort((a, b) => a[0] - b[0] || a[1].name.localeCompare(b[1].name, "zh")).map(([, f]) => f);
    return { groups: [{ title: "", rows: list.slice(0, SHOW).map((node) => ({ kind: "file", node, dir: rel(node.path) }) as Row) }], more: Math.max(0, list.length - SHOW), total: list.length };
  }, [bibMode, qt, bib, others, recent, docPath, root]);
  const rows = view.groups.flatMap((g) => g.rows);
  useEffect(() => setSel(0), [q]);

  // 放在光标下面；下面放不下就翻到上面。缩放原点落在光标那一点
  useLayoutEffect(() => {
    const el = box.current; if (!el) return;
    const r = el.getBoundingClientRect();
    const up = at.bottom + 6 + r.height > innerHeight - 8 && at.top - 6 - r.height > 8;
    const left = Math.round(Math.max(8, Math.min(at.left - 12, innerWidth - r.width - 8)));
    setPos({ left, top: Math.round(up ? at.top - 6 - r.height : at.bottom + 6), up });
  }, [at, rows.length]);
  useEffect(() => {
    const down = (e: MouseEvent) => { if (!box.current?.contains(e.target as Node)) onClose(); };
    addEventListener("mousedown", down, true);
    return () => removeEventListener("mousedown", down, true);
  }, [onClose]);

  const pick = (r?: Row) => { if (!r) return; onPick(r.kind === "file" ? { kind: "file", path: r.node.path } : { kind: "bib", key: r.b.key }); };
  const onKey = (e: React.KeyboardEvent) => {
    if (e.nativeEvent.isComposing) return;
    if (e.key === "ArrowDown" || e.key === "ArrowUp") { e.preventDefault(); if (rows.length) setSel((sel + (e.key === "ArrowDown" ? 1 : -1) + rows.length) % rows.length); }
    else if (e.key === "Enter") { e.preventDefault(); pick(rows[sel]); }
    else if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); onClose(); }
  };
  const hl = (name: string) => {
    if (!qt || bibMode) return name;
    const i = name.toLowerCase().indexOf(qt);
    return i < 0 ? name : <>{name.slice(0, i)}<b>{name.slice(i, i + qt.length)}</b>{name.slice(i + qt.length)}</>;
  };

  let idx = -1;
  return (
    <div ref={box} className={"ins" + (pos.up ? " up" : "")} role="dialog" aria-label="插入文件链接"
      style={{ left: pos.left, top: pos.top, transformOrigin: `${Math.round(at.left - pos.left)}px ${pos.up ? "100%" : "0"}` }}>
      <div className="ins-q">
        <Icon name={qt || bibMode ? "search" : "link"} size={15} />
        <input autoFocus value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={onKey} aria-label="输入名字筛选文件"
          placeholder={bib.length ? "插入文件链接，输入名字筛选；@ 插入文献" : "插入文件链接，输入名字筛选"} />
        {(qt || bibMode) && <span className="ins-n">{bibMode ? `${view.total} 条` : `${view.total} 个`}</span>}
      </div>
      <div className="ins-list" role="listbox">
        {view.groups.map((g, gi) => (
          <div key={gi}>
            {g.title && <div className="ins-gh">{g.title}</div>}
            {g.rows.map((r) => {
              idx++;
              const i = idx;
              return (
                <button key={i} type="button" role="option" aria-selected={i === sel} className={"ins-row" + (i === sel ? " sel" : "")} onMouseMove={() => setSel(i)} onClick={() => pick(r)}>
                  {r.kind === "file" ? <>
                    <FileBadge name={r.node.name} />
                    <span className="nm">{hl(r.node.name.replace(/\.(md|markdown)$/i, ""))}</span>
                    <span className="dir">{r.dir}</span>
                  </> : <>
                    <FileBadge name="x.bib" />
                    <span className="nm">{shortAuthor(r.b.author)}，{r.b.year}　<span className="dim">{r.b.title}</span></span>
                  </>}
                  <kbd className="ret" aria-hidden="true">↵</kbd>
                </button>
              );
            })}
            {!g.rows.length && <div className="ins-empty">{bibMode ? (bib.length ? "没有匹配的文献" : "文件夹里没有 .bib 文献库") : qt ? "文件夹里没有叫这个名字的文件" : "这个文件夹里没有别的文件"}</div>}
          </div>
        ))}
        {view.more > 0 && <div className="ins-more">还有 {view.more} 个，继续输入缩小范围</div>}
      </div>
      <div className="ins-foot">
        <button type="button" onMouseDown={(e) => e.preventDefault()} onClick={onPickOther} title="打开系统的文件窗口，选文件夹以外的文件"><Icon name="folder" size={14} />从电脑上选择…</button>
      </div>
    </div>
  );
}

/** 插入到正文里的写法：图片用 ![]()，其他文件用 [名字]()，路径相对于本文。
 *  中文直接写，不转成 %E6%96%87 这种；路径里有空格、括号时用 <…> 包起来（CommonMark 和 Pandoc 都认） */
export function linkFor(file: string, docPath: string) {
  const name = baseName(file);
  const r = relative(dirOf(docPath), file);
  const rel = /[\s()<>]/.test(r) ? `<${r}>` : r;
  if (TYPE[extOf(name)] === "img") return { text: `![${name.replace(/\.[^.]+$/, "")}](${rel})`, block: true };
  // PDF、Word、PPT、Excel、Markdown 单独成段，正文里显示成预览卡片
  return { text: `[${name.replace(/\.[^.]+$/, "")}](${rel})`, block: CARD_EXT.test(name) };
}
