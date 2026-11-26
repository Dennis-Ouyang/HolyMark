/** 目录里的折叠（和正文的折叠各管各的）：哪些标题有子级、收起某些标题后哪些条目要藏起来。 */
import type { Heading } from "./markdown";

/** 每个标题的键：文字 + 级别 + 第几次出现，插入别的标题后仍然对得上 */
export function outlineKeys(hs: Heading[]): string[] {
  const seen = new Map<string, number>();
  return hs.map((h) => { const k = `${h.level}|${h.text}`; const n = seen.get(k) ?? 0; seen.set(k, n + 1); return `${k}|${n}`; });
}

/** 有没有子级：后面紧跟着更深一级的标题 */
export function hasChildren(hs: Heading[]): boolean[] {
  return hs.map((h, i) => i + 1 < hs.length && hs[i + 1].level > h.level);
}

/** 收起 collapsed 里的标题后，每一条是否藏起来（被某个收起的祖先盖住） */
export function hiddenByCollapse(hs: Heading[], keys: string[], collapsed: Set<string>): boolean[] {
  const out: boolean[] = [];
  let hideBelow = Infinity; // 收起的那个标题的级别；遇到不比它深的标题就结束
  hs.forEach((h, i) => {
    if (h.level <= hideBelow) hideBelow = Infinity;
    out.push(hideBelow !== Infinity);
    if (hideBelow === Infinity && collapsed.has(keys[i])) hideBelow = h.level;
  });
  return out;
}
