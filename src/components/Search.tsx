/**
 * ⌘K 搜索：范围（全部 / 本文 / 文件夹 / 命令）、左边按文件归组的结果、右边连续的上下文预览。
 * 预览里匹配处停在中间，越往上下文字越淡，可以滚动看前后文；右侧细条标出这篇文件里所有匹配的位置。
 */
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Icon } from "./Icons";
import type { PaletteItem } from "./Dialogs";
import { plainText, type Heading } from "../lib/markdown";
import { baseName, dirOf, relative } from "../lib/paths";
import { keyName } from "../lib/platform";

type Scope = "all" | "doc" | "folder" | "cmd";
interface Hit { pos: number; len: number; pre: string; hit: string; post: string; where: string }
interface FileHits { path: string; name: string; dir: string; text: string; hits: Hit[] }
type Row =
  | { kind: "doc"; hit: Hit }
  | { kind: "file"; file: FileHits; hit: Hit; sub: boolean }
  | { kind: "cmd"; item: PaletteItem };

interface Props {
  text: string;
  path: string;
  root: string;
  headings: Heading[];
  folderTexts: Map<string, string>;
  commands: PaletteItem[];
  onJump: (pos: number, len: number) => void;
  onOpenAt: (path: string, pos: number, len: number) => void;
  onClose: () => void;
}

const MAX_DOC = 300, MAX_PER_FILE = 50;

/** 在一段源码里找出所有匹配（不区分大小写），附上下文和所在的标题 */
function findAll(src: string, q: string, hs: Heading[] | null, max: number): Hit[] {
  const out: Hit[] = [];
  const lower = src.toLowerCase(), ql = q.toLowerCase();
  let headIdx = -1;
  for (let i = lower.indexOf(ql); i >= 0 && out.length < max; i = lower.indexOf(ql, i + ql.length)) {
    const ls = src.lastIndexOf("\n", i - 1) + 1;
    let le = src.indexOf("\n", i); if (le < 0) le = src.length;
    const line = src.slice(ls, le);
    // 前后文用纯文本（去掉 Markdown 符号），太长就截掉
    const pre = plainText(line.slice(0, i - ls)).slice(-14); // 前文短一点，保证匹配的字在一行里看得见
    const post = plainText(line.slice(i - ls + q.length)).slice(0, 60);
    let where = "";
    if (hs) { while (headIdx + 1 < hs.length && hs[headIdx + 1].pos <= i) headIdx++; where = headIdx >= 0 ? hs[headIdx].text : ""; }
    out.push({ pos: i, len: q.length, pre: (pre.length >= 14 ? "…" : "") + pre, hit: src.slice(i, i + q.length), post, where });
  }
  return out;
}

export function SearchPanel({ text, path, root, headings, folderTexts, commands, onJump, onOpenAt, onClose }: Props) {
  const [q, setQ] = useState("");
  const [scope, setScope] = useState<Scope>("all");
  const [sel, setSel] = useState(0);
  const [open, setOpen] = useState<Set<string>>(new Set());
  const qt = q.trim();

  const docHits = useMemo(() => (qt ? findAll(text, qt, headings, MAX_DOC) : []), [text, qt, headings]);
  const files = useMemo<FileHits[]>(() => {
    if (!qt) return [];
    const out: FileHits[] = [];
    folderTexts.forEach((t, p) => {
      const nameHit = baseName(p).toLowerCase().includes(qt.toLowerCase());
      const hits = findAll(t, qt, null, MAX_PER_FILE);
      if (hits.length || nameHit) out.push({ path: p, name: baseName(p).replace(/\.(md|markdown)$/i, ""), dir: dirOf(relative(root, p)), text: t, hits });
    });
    return out.sort((a, b) => b.hits.length - a.hits.length);
  }, [folderTexts, qt, root]);
  const cmds = useMemo(() => {
    const ql = qt.toLowerCase();
    return commands.filter((c) => !ql || (c.title + " " + (c.sub || "")).toLowerCase().includes(ql));
  }, [commands, qt]);

  const groups = useMemo(() => {
    const g: { title: string; count: string; rows: Row[] }[] = [];
    const show = (s: Scope) => scope === "all" || scope === s;
    if (qt && show("doc") && docHits.length) g.push({ title: "本文", count: `${docHits.length}${docHits.length >= MAX_DOC ? "+" : ""} 处`, rows: docHits.slice(0, scope === "doc" ? MAX_DOC : 6).map((hit) => ({ kind: "doc", hit })) });
    if (qt && show("folder") && files.length) {
      const rows: Row[] = [];
      for (const f of files.slice(0, scope === "folder" ? 100 : 8)) {
        rows.push({ kind: "file", file: f, hit: f.hits[0] ?? { pos: 0, len: 0, pre: "", hit: "", post: "文件名匹配", where: "" }, sub: false });
        if (open.has(f.path)) f.hits.slice(1).forEach((hit) => rows.push({ kind: "file", file: f, hit, sub: true }));
      }
      g.push({ title: "文件夹", count: `${files.length} 个文件`, rows });
    }
    if (show("cmd") && cmds.length) g.push({ title: qt ? "命令" : "命令与跳转", count: "", rows: cmds.slice(0, qt && scope === "all" ? 6 : 60).map((item) => ({ kind: "cmd", item })) });
    return g;
  }, [qt, scope, docHits, files, cmds, open, path]);
  const rows = useMemo(() => groups.flatMap((g) => g.rows), [groups]);
  const cur = rows[Math.min(sel, rows.length - 1)];
  useEffect(() => setSel(0), [qt, scope]);

  const counts: Record<Scope, string> = {
    all: "", doc: qt ? String(docHits.length) : "", folder: qt ? String(files.reduce((n, f) => n + f.hits.length, 0)) : "", cmd: String(cmds.length),
  };
  // 数量为 0 时不显示（H18）
  for (const k of Object.keys(counts) as Scope[]) if (counts[k] === "0") counts[k] = "";
  const run = (r?: Row) => {
    if (!r) return;
    onClose();
    if (r.kind === "doc") onJump(r.hit.pos, r.hit.len);
    else if (r.kind === "file") onOpenAt(r.file.path, r.hit.pos, r.hit.len);
    else r.item.run();
  };
  const groupStarts = useMemo(() => { const out: number[] = []; let i = 0; for (const g of groups) { out.push(i); i += g.rows.length; } return out; }, [groups]);

  const onKey = (e: React.KeyboardEvent) => {
    if (e.nativeEvent.isComposing) return;
    const n = rows.length;
    if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); onClose(); return; }
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      if (!n) return;
      if (e.metaKey || e.ctrlKey) {
        const gi = groupStarts.filter((s) => s <= sel).length - 1;
        const next = e.key === "ArrowDown" ? groupStarts[gi + 1] ?? groupStarts[0] : groupStarts[(gi - 1 + groupStarts.length) % groupStarts.length];
        setSel(next);
      } else setSel((sel + (e.key === "ArrowDown" ? 1 : -1) + n) % n);
    } else if (e.key === "Enter") { e.preventDefault(); run(cur); }
    else if (e.key === "Tab") {
      e.preventDefault();
      const order: Scope[] = ["all", "doc", "folder", "cmd"];
      setScope(order[(order.indexOf(scope) + (e.shiftKey ? 3 : 1)) % 4]);
    } else if (e.key === "ArrowRight" && cur?.kind === "file" && !cur.sub && cur.file.hits.length > 1 && (e.currentTarget as HTMLInputElement).selectionStart === q.length) {
      e.preventDefault();
      setOpen((s) => { const x = new Set(s); if (x.has(cur.file.path)) x.delete(cur.file.path); else x.add(cur.file.path); return x; });
    }
  };

  const listRef = useRef<HTMLDivElement>(null);
  useEffect(() => { listRef.current?.querySelector(".srow.sel")?.scrollIntoView({ block: "nearest" }); }, [sel, rows]);

  // 预览：本文或那个文件；没有选中搜索结果（比如选的是命令）时不显示
  const preview = cur && cur.kind !== "cmd" && cur.hit.len ? {
    src: cur.kind === "doc" ? text : cur.file.text,
    name: cur.kind === "doc" ? baseName(path).replace(/\.(md|markdown)$/i, "") : cur.file.name,
    hit: cur.hit,
    all: cur.kind === "doc" ? docHits : cur.file.hits,
  } : null;

  let gi = -1, idx = -1;
  return (
    <div className="scrim" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className={"search" + (preview ? " has-pv" : "") + (groups.length ? "" : " none")} role="dialog" aria-label="搜索">
        <div className="s-top">
          <Icon name="search" size={18} />
          <input autoFocus value={q} placeholder="搜索本文、文件夹，或输入命令" aria-label="搜索" onChange={(e) => setQ(e.target.value)} onKeyDown={onKey} />
          <div className="s-scope" role="radiogroup" aria-label="范围">
            {([["all", "全部"], ["doc", "本文"], ["folder", "文件夹"], ["cmd", "命令"]] as [Scope, string][]).map(([k, l]) => (
              <button key={k} type="button" role="radio" aria-checked={scope === k} className={scope === k ? "on" : ""} onMouseDown={(e) => e.preventDefault()} onClick={() => setScope(k)}>
                {l}{counts[k] && <span>{counts[k]}</span>}
              </button>
            ))}
          </div>
        </div>
        <div className="s-body">
          <div className={"s-list" + (preview ? "" : " wide")} ref={listRef}>
            {groups.length ? groups.map((g) => {
              gi++;
              return (
                <div key={g.title + gi}>
                  <div className="s-gh"><span>{g.title}</span><span>{g.count}</span></div>
                  {g.rows.map((r) => {
                    idx++;
                    const i = idx, on = i === sel;
                    const mark = (h: Hit) => <span className="s-snip">{h.pre}<mark>{h.hit}</mark>{h.post}</span>;
                    return (
                      <button key={i} type="button" className={"srow" + (on ? " sel" : "") + (r.kind === "file" && r.sub ? " sub" : "")} onMouseMove={() => setSel(i)} onClick={() => run(r)}>
                        {r.kind === "doc" && <><span className="s-where">{r.hit.where || "开头"}</span>{mark(r.hit)}</>}
                        {r.kind === "file" && !r.sub && <>
                          <span className="s-file"><Icon name="doc" size={14} /><b>{r.file.name}</b><small>{r.file.dir}</small>
                            {r.file.hits.length > 0 && <em className={r.file.hits.length > 1 ? "more" : ""} title={r.file.hits.length > 1 ? "按 → 展开全部匹配" : undefined}
                              onClick={(e) => { if (r.file.hits.length < 2) return; e.stopPropagation(); setOpen((s) => { const x = new Set(s); if (x.has(r.file.path)) x.delete(r.file.path); else x.add(r.file.path); return x; }); }}>
                              {r.file.hits.length} 处{r.file.hits.length > 1 && <Icon name="chev" size={10} />}</em>}</span>
                          {r.hit.len ? mark(r.hit) : <span className="s-snip">文件名匹配</span>}
                        </>}
                        {r.kind === "file" && r.sub && mark(r.hit)}
                        {r.kind === "cmd" && <span className="s-cmd"><span>{r.item.title}</span>{r.item.keys && <span className="sc">{r.item.keys.map((k) => <kbd key={k}>{k}</kbd>)}</span>}</span>}
                        <kbd className="s-ret" aria-hidden="true">↵</kbd>
                      </button>
                    );
                  })}
                </div>
              );
            }) : <div className="s-none">{qt ? <>
              <p>没有找到「{qt}」。换个词试试{scope !== "all" && scope !== "folder" ? "，或者在整个文件夹里找" : ""}。</p>
              {scope !== "all" && scope !== "folder" && <button type="button" className="btn sm" onMouseDown={(e) => e.preventDefault()} onClick={() => setScope("folder")}>在文件夹里找</button>}
            </> : <p>输入要找的文字，或者命令的名字</p>}</div>}
          </div>
          {preview && <Preview {...preview} q={qt} />}
        </div>
        <div className="s-foot"><span><kbd>↑</kbd> <kbd>↓</kbd> 选择</span><span><kbd>Tab</kbd> 换范围</span><span><kbd>{keyName("⌘")}</kbd> <kbd>↑</kbd> <kbd>↓</kbd> 跳到上 / 下一组</span><span><kbd>→</kbd> 展开文件里的全部匹配</span></div>
      </div>
    </div>
  );
}

/** 预览：只渲染匹配处前后一段（长稿也不卡），匹配处滚到正中间 */
function Preview({ src, name, hit, all, q }: { src: string; name: string; hit: Hit; all: Hit[]; q: string }) {
  const box = useRef<HTMLDivElement>(null);
  const blocks = useMemo(() => {
    // 按空行切成段，取匹配所在段的前后各 30 段
    const parts: { from: number; text: string }[] = [];
    const re = /\n\s*\n/g;
    let last = 0, m: RegExpExecArray | null;
    while ((m = re.exec(src))) { parts.push({ from: last, text: src.slice(last, m.index) }); last = m.index + m[0].length; }
    parts.push({ from: last, text: src.slice(last) });
    let k = parts.findIndex((p, i) => hit.pos >= p.from && (i === parts.length - 1 || hit.pos < parts[i + 1].from));
    if (k < 0) k = 0;
    return parts.slice(Math.max(0, k - 30), k + 31).map((p) => ({ ...p, cur: hit.pos >= p.from && hit.pos <= p.from + p.text.length }));
  }, [src, hit.pos]);
  const heading = (t: string) => t.match(/^(#{1,6})\s+(.*)$/);
  const marked = (t: string, isCur: boolean, from: number) => {
    // 这一段里所有匹配都标出来，当前这一处标得更重
    const out: React.ReactNode[] = [];
    const plain = t;
    const lower = plain.toLowerCase(), ql = q.toLowerCase();
    let i = 0, n = 0;
    for (let j = lower.indexOf(ql); j >= 0; j = lower.indexOf(ql, j + ql.length)) {
      out.push(plainText(plain.slice(i, j)));
      out.push(<mark key={n++} className={isCur && from + j === hit.pos ? "cur" : ""}>{plain.slice(j, j + q.length)}</mark>);
      i = j + q.length;
    }
    out.push(plainText(plain.slice(i)));
    return out;
  };
  useLayoutEffect(() => {
    const el = box.current; if (!el) return;
    const m = el.querySelector<HTMLElement>("mark.cur");
    if (m) el.scrollTop = m.offsetTop - el.clientHeight / 2 + m.offsetHeight / 2;
  }, [blocks, hit.pos]);
  return (
    <div className="s-pv">
      <div className="s-pvh"><b>{name}</b>{hit.where && <><Icon name="chev" size={10} /><span>{hit.where}</span></>}</div>
      <div className="s-pvb">
        <div className="s-pvs" ref={box}>
          {blocks.map((b, i) => {
            const h = heading(b.text);
            return h ? <div key={i} className={"s-h l" + h[1].length}>{marked(h[2], b.cur, b.from + h[0].length - h[2].length)}</div>
              : <p key={i}>{marked(b.text, b.cur, b.from)}</p>;
          })}
          <div className="pad" />
        </div>
        <div className="s-fade" aria-hidden="true" />
        <div className="s-ticks" aria-label="这篇文件里所有匹配的位置">
          {all.map((h, i) => <i key={i} className={h.pos === hit.pos ? "cur" : ""} style={{ top: `${(h.pos / Math.max(1, src.length)) * 100}%` }} />)}
        </div>
      </div>
    </div>
  );
}
