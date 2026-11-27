/**
 * N18 文件树手动排序（纯函数）：顺序存在文件夹的 .holymark/order.json，按文件夹记一串名字。
 * - 「按名称」时就是自然排序（sortTree.ts）；
 * - 「手动」时每个文件夹里记过的名字按记的顺序排在前面，没记的（新建的文件）按自然顺序排在最后；
 * - 改名、移动、删除时同步改顺序表；批量导出（G3）合并文稿时按这个顺序。
 */
import type { TreeNode } from "./backend";
import { sortTree } from "./sortTree";

export interface TreeOrder {
  mode: "name" | "manual";
  /** 键是相对于工作区的文件夹路径（最外层是 ""），值是这个文件夹里的名字顺序 */
  dirs: Record<string, string[]>;
}
export const NO_ORDER: TreeOrder = { mode: "name", dirs: {} };

export function parseOrder(text: string): TreeOrder {
  try {
    const j = JSON.parse(text);
    const dirs: Record<string, string[]> = {};
    if (j && typeof j.dirs === "object") for (const [k, v] of Object.entries(j.dirs)) if (Array.isArray(v)) dirs[k] = v.filter((x): x is string => typeof x === "string");
    return { mode: j?.mode === "manual" ? "manual" : "name", dirs };
  } catch { return NO_ORDER; }
}
export const orderText = (o: TreeOrder) => JSON.stringify(o, null, 2) + "\n";

const rel = (root: string, p: string) => (p === root ? "" : p.startsWith(root + "/") ? p.slice(root.length + 1) : p);
const parentRel = (r: string) => (r.includes("/") ? r.slice(0, r.lastIndexOf("/")) : "");
const nameOf = (r: string) => r.slice(r.lastIndexOf("/") + 1);

/** 按顺序表排好的树（先自然排序，手动时再按记的名字调整） */
export function orderTree(nodes: TreeNode[], order: TreeOrder, root: string): TreeNode[] {
  const sorted = sortTree(nodes);
  if (order.mode !== "manual") return sorted;
  const walk = (ns: TreeNode[], dir: string): TreeNode[] => {
    const list = order.dirs[rel(root, dir)] ?? [];
    const at = new Map(list.map((n, i) => [n, i]));
    const kids = ns.map((n) => (n.dir ? { ...n, children: walk(n.children, n.path) } : n));
    const listed = kids.filter((n) => at.has(n.name)).sort((a, b) => at.get(a.name)! - at.get(b.name)!);
    return [...listed, ...kids.filter((n) => !at.has(n.name))];
  };
  return walk(sorted, root);
}

/** 文件夹 dir 里现在显示的名字顺序 */
export function namesIn(tree: TreeNode[], root: string, dir: string): string[] {
  if (dir === root) return tree.map((n) => n.name);
  const find = (ns: TreeNode[]): TreeNode | null => { for (const n of ns) { if (n.path === dir) return n; if (n.dir) { const f = find(n.children); if (f) return f; } } return null; };
  return find(tree)?.children.map((n) => n.name) ?? [];
}

/** 在 dirRel 里把 name 挪到 before 前面（null 是最后）；current 是现在显示的顺序。会把这个文件夹的整串名字记下来 */
export function reorder(o: TreeOrder, dirRel: string, current: string[], name: string, before: string | null): TreeOrder {
  const list = current.filter((n) => n !== name);
  const i = before === null ? list.length : list.indexOf(before);
  list.splice(i < 0 ? list.length : i, 0, name);
  return { mode: "manual", dirs: { ...o.dirs, [dirRel]: list } };
}

/** 改名或移动：from、to 都是相对路径。同一个文件夹里改名就换掉名字（位置不变）；移到别处就从原来的表里去掉（到新文件夹排在最后） */
export function renameEntry(o: TreeOrder, from: string, to: string): TreeOrder {
  if (from === to) return o;
  const dirs: Record<string, string[]> = {};
  const pf = parentRel(from), pt = parentRel(to);
  for (const [k, v] of Object.entries(o.dirs)) {
    // 文件夹本身改名、移动：它和它下面的表跟着换键
    const key = k === from ? to : k.startsWith(from + "/") ? to + k.slice(from.length) : k;
    let list = v;
    if (k === pf) list = pf === pt ? v.map((n) => (n === nameOf(from) ? nameOf(to) : n)) : v.filter((n) => n !== nameOf(from));
    dirs[key] = list;
  }
  return { ...o, dirs };
}

/** 删除：从上一级的表里去掉，它下面的表也去掉 */
export function removeEntry(o: TreeOrder, r: string): TreeOrder {
  const dirs: Record<string, string[]> = {};
  for (const [k, v] of Object.entries(o.dirs)) {
    if (k === r || k.startsWith(r + "/")) continue;
    dirs[k] = k === parentRel(r) ? v.filter((n) => n !== nameOf(r)) : v;
  }
  return { ...o, dirs };
}
