/**
 * N14 安静的写作统计：
 * - 打开文稿时定今天的起点，每次自动保存记一次终点（存在应用自己的存储里）；
 * - 状态栏「全文」字数浮窗里多两样：今天净增多少字、最近 7 天每天一根的小柱子；
 * - 文件树里悬停一篇显示它的字数（交给统一的悬停提示 TooltipLayer）。
 * 不提醒、不打卡，也不用颜色强调。
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Backend, TreeNode } from "../lib/backend";
import { countWords, plainText, wordCounter } from "../lib/markdown";
import { dayKey, lastDays, loadLog, record, renameFile, saveLog, WritingLog } from "../lib/writingLog";
import { setTipSource } from "../components/Tooltip";

const isMd = (p: string) => /\.(md|markdown)$/i.test(p);

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
  // 文件树悬停 Markdown 文稿显示字数：交给统一的 TooltipLayer（data-tipsrc="words"），只有一个提示框
  useEffect(() => setTipSource("words", async (el) => {
    const p = el.dataset.path;
    if (!p || !isMd(p)) return null;
    return `${(await ctx.current.countOf(p)).toLocaleString()} 字`;
  }), []);

  return { noteOpen, noteSave, noteMove, Section };
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
