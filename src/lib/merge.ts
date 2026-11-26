/**
 * 按块三方合并：外部程序改写了文件，而编辑器里还有没写盘的字时用。
 * 基线 base 是上次写盘（或读盘）的内容，mine 是编辑器里的，theirs 是磁盘上新的。
 * 块是「连续的非空行 + 后面的空行」，拼回去和原文一字不差。
 * 两边改的是不同块就直接合并；改了同一处时两边都保留（先我方，后对方），并报告有冲突。
 */

/** 切块：每块是一段连续的非空行，带上它后面的空行 */
export function blocksOf(text: string): string[] {
  const out: string[] = [];
  const re = /[^\n]*(?:\n|$)/g;
  let cur = "", blank = false;
  for (let m: RegExpExecArray | null; (m = re.exec(text)) && m[0] !== ""; ) {
    const line = m[0], empty = line.trim() === "";
    if (!empty && blank) { out.push(cur); cur = ""; }
    cur += line;
    blank = empty;
    if (re.lastIndex >= text.length) break;
  }
  if (cur) out.push(cur);
  return out;
}

/** a 和 b 的最长公共子序列：返回配对的下标 [i, j] */
function lcs(a: string[], b: string[]): [number, number][] {
  // 先去掉相同的头尾，长稿里通常只剩很短一段要算
  let s = 0;
  while (s < a.length && s < b.length && a[s] === b[s]) s++;
  let e = 0;
  while (e < a.length - s && e < b.length - s && a[a.length - 1 - e] === b[b.length - 1 - e]) e++;
  const A = a.slice(s, a.length - e), B = b.slice(s, b.length - e);
  const n = A.length, m = B.length;
  const pairs: [number, number][] = [];
  for (let k = 0; k < s; k++) pairs.push([k, k]);
  if (n && m) {
    const dp = new Uint32Array((n + 1) * (m + 1));
    for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) {
      dp[i * (m + 1) + j] = A[i] === B[j] ? dp[(i + 1) * (m + 1) + j + 1] + 1 : Math.max(dp[(i + 1) * (m + 1) + j], dp[i * (m + 1) + j + 1]);
    }
    for (let i = 0, j = 0; i < n && j < m; ) {
      if (A[i] === B[j]) { pairs.push([s + i, s + j]); i++; j++; }
      else if (dp[(i + 1) * (m + 1) + j] >= dp[i * (m + 1) + j + 1]) i++;
      else j++;
    }
  }
  for (let k = 0; k < e; k++) pairs.push([a.length - e + k, b.length - e + k]);
  return pairs;
}

/** 两块拼在一起时保证中间有空行（冲突时两边都保留用） */
function glue(parts: string[]): string[] {
  return parts.map((p, i) => (i < parts.length - 1 && !/\n\n$/.test(p) ? p.replace(/\n?$/, "\n\n") : p));
}

export interface MergeResult { text: string; conflicts: number }

export function merge3(base: string, mine: string, theirs: string): MergeResult {
  if (mine === base || mine === theirs) return { text: theirs, conflicts: 0 };
  if (theirs === base) return { text: mine, conflicts: 0 };
  const B = blocksOf(base), M = blocksOf(mine), T = blocksOf(theirs);
  const bm = new Map(lcs(B, M)), bt = new Map(lcs(B, T));
  // 两边都没动的基线块是锚点，锚点之间各自比较
  const anchors: [number, number, number][] = [];
  for (let i = 0; i < B.length; i++) if (bm.has(i) && bt.has(i)) anchors.push([i, bm.get(i)!, bt.get(i)!]);
  anchors.push([B.length, M.length, T.length]);
  const out: string[] = [];
  let conflicts = 0, pb = 0, pm = 0, pt = 0;
  const same = (x: string[], y: string[]) => x.length === y.length && x.every((v, k) => v === y[k]);
  for (const [ib, im, it] of anchors) {
    const cb = B.slice(pb, ib), cm = M.slice(pm, im), ct = T.slice(pt, it);
    if (same(cm, cb)) out.push(...ct);
    else if (same(ct, cb) || same(cm, ct)) out.push(...cm);
    else { conflicts++; out.push(...glue([...cm, ...ct])); }
    if (ib < B.length) out.push(B[ib]);
    pb = ib + 1; pm = im + 1; pt = it + 1;
  }
  return { text: glue(out.filter((x) => x !== "")).join(""), conflicts };
}
