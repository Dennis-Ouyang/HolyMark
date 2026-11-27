/**
 * N3 记住每一篇读到、写到哪里：光标、屏幕最上方是哪一段（文档位置，不用像素：字号变了也对得上）、
 * 折叠了哪些标题（行号）、是否在阅读模式。按绝对路径记，最多留最近 500 篇；
 * 存在应用自己的存储里（localStorage），不写进用户的文件夹。
 */

export interface Spot {
  anchor: number;
  head: number;
  /** 屏幕最上方那一块的起点（文档位置） */
  top: number;
  /** 折起来的标题所在的行号 */
  folds: number[];
  reading: boolean;
  /** 最后一次记的时间，用来淘汰最旧的 */
  at: number;
}
export type SpotStore = Record<string, Spot>;

export const MAX_SPOTS = 500;

export function rememberSpot(store: SpotStore, path: string, spot: Spot, max = MAX_SPOTS): SpotStore {
  const next = { ...store, [path]: spot };
  const keys = Object.keys(next);
  if (keys.length > max) {
    keys.sort((a, b) => next[a].at - next[b].at);
    for (const k of keys.slice(0, keys.length - max)) delete next[k];
  }
  return next;
}

/** 文件被外部改短了：位置夹在有效范围内，行号超出的折叠丢掉 */
export function clampSpot(s: Spot, docLength: number, lines: number): Spot {
  const c = (n: number) => Math.max(0, Math.min(docLength, Math.floor(n) || 0));
  return { ...s, anchor: c(s.anchor), head: c(s.head), top: c(s.top), folds: s.folds.filter((n) => n >= 1 && n <= lines) };
}

/** 改名、移动后跟着换路径（文件夹时是里面所有文件） */
export function renameSpots(store: SpotStore, from: string, to: string): SpotStore {
  const out: SpotStore = {};
  for (const [k, v] of Object.entries(store)) out[k === from ? to : k.startsWith(from + "/") ? to + k.slice(from.length) : k] = v;
  return out;
}

const KEY = "holymark-positions";
export function loadSpots(): SpotStore {
  try { const x = JSON.parse(localStorage.getItem(KEY) || "{}"); return x && typeof x === "object" ? x : {}; } catch { return {}; }
}
export function saveSpots(s: SpotStore) {
  try { localStorage.setItem(KEY, JSON.stringify(s)); } catch { /* 存不了就算了 */ }
}
