/**
 * 安静的写作统计：每次打开、自动保存时记下这篇的字数，算出每天净增多少字。
 * 存在应用自己的存储里（localStorage），不写进用户的文件夹。不提醒、不打卡。
 *
 * 结构：days[日期][文件] = [当天第一次的字数, 最后一次的字数]，字数「不含标点」「含标点」各记一份，
 * 这样设置里切换口径后，统计也跟着对得上。
 */

/** [不含标点的起点, 不含标点的终点, 含标点的起点, 含标点的终点] */
export type DayEntry = [number, number, number, number];
export interface WritingLog { v: 1; days: Record<string, Record<string, DayEntry>> }

export const emptyLog = (): WritingLog => ({ v: 1, days: {} });

/** 本地日期 2026-11-26 */
export function dayKey(d = new Date()): string {
  const z = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${z(d.getMonth() + 1)}-${z(d.getDate())}`;
}

const KEEP_DAYS = 60;

/**
 * 记一次。first=true 表示刚打开（只定起点，不算写了字）。
 * 今天第一次碰到这篇时，起点用这次的字数；之后只更新终点。
 */
export function record(log: WritingLog, day: string, file: string, plain: number, punct: number, first = false): WritingLog {
  const days = { ...log.days };
  const today = { ...(days[day] || {}) };
  const e = today[file];
  if (!e) today[file] = [plain, plain, punct, punct];
  else if (!first) today[file] = [e[0], plain, e[2], punct];
  else return log;
  days[day] = today;
  // 只留最近 60 天
  const keys = Object.keys(days).sort();
  for (const k of keys.slice(0, Math.max(0, keys.length - KEEP_DAYS))) delete days[k];
  return { v: 1, days };
}

/** 改名、移动后，今天的记录跟着换路径 */
export function renameFile(log: WritingLog, from: string, to: string): WritingLog {
  const days: WritingLog["days"] = {};
  for (const [d, files] of Object.entries(log.days)) {
    const n: Record<string, DayEntry> = {};
    for (const [f, e] of Object.entries(files)) n[f === from ? to : f.startsWith(from + "/") ? to + f.slice(from.length) : f] = e;
    days[d] = n;
  }
  return { v: 1, days };
}

/** 某一天所有文稿的净增字数（删掉的字是负数） */
export function netOn(log: WritingLog, day: string, withPunct: boolean): number {
  const files = log.days[day];
  if (!files) return 0;
  let n = 0;
  for (const e of Object.values(files)) n += withPunct ? e[3] - e[2] : e[1] - e[0];
  return n;
}

/** 截至 today 的最近 n 天，从早到晚 */
export function lastDays(log: WritingLog, today: Date, n: number, withPunct: boolean): { day: string; date: Date; net: number }[] {
  const out = [];
  for (let i = n - 1; i >= 0; i--) {
    const d = new Date(today.getFullYear(), today.getMonth(), today.getDate() - i);
    const k = dayKey(d);
    out.push({ day: k, date: d, net: netOn(log, k, withPunct) });
  }
  return out;
}

const KEY = "holymark-writing-log";
export function loadLog(): WritingLog {
  try { const x = JSON.parse(localStorage.getItem(KEY) || ""); if (x && x.v === 1 && x.days) return x; } catch { /* 没有记录 */ }
  return emptyLog();
}
export function saveLog(log: WritingLog) {
  try { localStorage.setItem(KEY, JSON.stringify(log)); } catch { /* 存不了就算了，不影响写作 */ }
}
