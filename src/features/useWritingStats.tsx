/**
 * N14 安静的写作统计：
 * - 打开文稿时定今天的起点，每次自动保存记一次终点（存在应用自己的存储里）；
 * - 状态栏「全文」字数浮窗里多两样：今天净增多少字、最近 7 天每天一根的小柱子；
 * - 文件树里悬停一篇显示它的字数，悬停文件夹显示合计。
 * 不提醒、不打卡，也不用颜色强调。
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Backend, TreeNode } from "../lib/backend";
import { countWords, plainText, wordCounter } from "../lib/markdown";
import { dayKey, lastDays, loadLog, record, renameFile, saveLog, WritingLog } from "../lib/writingLog";
import { Presence } from "../components/Presence";

const isMd = (p: string) => /\.(md|markdown)$/i.test(p);
const flatten = (ns: TreeNode[]): TreeNode[] => ns.flatMap((n) => (n.dir ? flatten(n.children) : [n]));

export function useWritingStats({ be, tree, livePath, liveText, withPunct }: { be: Backend | null; tree: TreeNode[]; livePath: () => string; liveText: () => string; withPunct: boolean }) {
  const log = useRef<WritingLog>(loadLog());
  const [rev, setRev] = useState(0);
  // 两种口径各用一个增量计数器（计数器按块缓存，交替用同一个会互相冲掉缓存）
  const plainC = useMemo(wordCounter, []), punctC = useMemo(wordCounter, []);
  const write = (path: string, text: string, first: boolean) => {
    if (!path || !isMd(path)) return;
    log.current = record(log.current, dayKey(), path, plainC(text, false), punctC(text, true), first);
    saveLog(log.current);
    setRev((r) => r + 1);
  };
  const noteOpen = useCallback((path: string, text: string) => write(path, text, true), []); // eslint-disable-line react-hooks/exhaustive-deps
  const noteSave = useCallback((path: string, text: string) => write(path, text, false), []); // eslint-disable-line react-hooks/exhaustive-deps
  const noteMove = useCallback((from: string, to: string) => { log.current = renameFile(log.current, from, to); saveLog(log.current); }, []);

  /** 字数浮窗里的「今天」和最近 7 天 */
  const Section = useMemo(() => function StatsSection() {
    const days = lastDays(log.current, new Date(), 7, withPunct);
    return <WeekBars days={days} />;
  }, [rev, withPunct]); // eslint-disable-line react-hooks/exhaustive-deps

  /* ---------- 文件树悬停 ---------- */
  const [tip, setTip] = useState<{ left: number; top: number; main: string; sub?: string } | null>(null);
  const cache = useRef(new Map<string, number>());
  useEffect(() => { cache.current.clear(); }, [tree]);
  const countOf = async (p: string): Promise<number> => {
    if (p === livePath()) return countWords(plainText(liveText()), withPunct);
    const k = (withPunct ? "P" : "N") + p;
    if (cache.current.has(k)) return cache.current.get(k)!;
    const t = be ? await be.readText(p).catch(() => "") : "";
    const n = countWords(plainText(t), withPunct);
    cache.current.set(k, n);
    return n;
  };
  const ctx = useRef({ countOf, tree });
  ctx.current = { countOf, tree };
  useEffect(() => {
    let timer = 0, cur: HTMLElement | null = null;
    const find = (path: string, ns: TreeNode[]): TreeNode | null => { for (const n of ns) { if (n.path === path) return n; const c = n.dir ? find(path, n.children) : null; if (c) return c; } return null; };
    const over = (e: MouseEvent) => {
      const el = (e.target as HTMLElement).closest<HTMLElement>(".tree .tn[data-path]");
      if (el === cur) return;
      cur = el;
      window.clearTimeout(timer);
      setTip(null);
      if (!el) return;
      timer = window.setTimeout(async () => {
        const p = el.dataset.path!;
        const node = find(p, ctx.current.tree);
        if (!node) return;
        const r = el.getBoundingClientRect();
        const pos = { left: Math.round(r.right + 8), top: Math.round(r.top + r.height / 2 - 14) };
        if (!node.dir) {
          if (!isMd(p)) return;
          const n = await ctx.current.countOf(p);
          if (cur === el) setTip({ ...pos, main: `${n.toLocaleString()} 字` });
        } else {
          const files = flatten(node.children).filter((f) => isMd(f.path));
          if (!files.length) return;
          const ns = await Promise.all(files.map((f) => ctx.current.countOf(f.path)));
          if (cur === el) setTip({ ...pos, main: `共 ${ns.reduce((a, b) => a + b, 0).toLocaleString()} 字`, sub: `${files.length} 篇` });
        }
      }, 450);
    };
    const leave = () => { cur = null; window.clearTimeout(timer); setTip(null); };
    document.addEventListener("mouseover", over);
    document.addEventListener("mousedown", leave, true);
    return () => { document.removeEventListener("mouseover", over); document.removeEventListener("mousedown", leave, true); window.clearTimeout(timer); };
  }, []);
  const treeTip = <Presence ms={90}>{tip && <div className="hm-tip" role="tooltip" style={{ left: tip.left, top: tip.top }}><b className="num">{tip.main}</b>{tip.sub && <span className="num">{tip.sub}</span>}</div>}</Presence>;

  return { noteOpen, noteSave, noteMove, Section, treeTip };
}

/** 最近 7 天：每天一根柱子，等宽数字，不用颜色强调；悬停哪根，上面就显示哪天的数 */
function WeekBars({ days }: { days: { day: string; date: Date; net: number }[] }) {
  const [hover, setHover] = useState<number | null>(null);
  const max = Math.max(1, ...days.map((d) => d.net));
  const today = days[days.length - 1];
  const sel = hover === null ? null : days[hover];
  const sign = (n: number) => (n > 0 ? "+" : n < 0 ? "−" : "") + Math.abs(n).toLocaleString();
  const wk = "日一二三四五六";
  return (
    <div className="wstats">
      <div className="ws-head">
        <span>{sel ? `${sel.date.getMonth() + 1}月${sel.date.getDate()}日` : "今天净增"}</span>
        <b className="num">{sign(sel ? sel.net : today.net)}</b>
      </div>
      <div className="ws-bars" onMouseLeave={() => setHover(null)} aria-label="最近 7 天每天净增的字数">
        {days.map((d, i) => (
          <div key={d.day} className={"ws-col" + (hover === i ? " on" : "")} onMouseEnter={() => setHover(i)} aria-label={`${d.day} ${sign(d.net)}`}>
            <i style={{ height: `${Math.max(d.net > 0 ? 6 : 2, Math.round((Math.max(0, d.net) / max) * 100))}%` }} />
            <span>{i === days.length - 1 ? "今" : wk[d.date.getDay()]}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
