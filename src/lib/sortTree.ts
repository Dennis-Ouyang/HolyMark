/**
 * 文件树的排序（H1）：文件夹在前；去掉扩展名后按数字感知的自然顺序（「第2章」在「第10章」前面，
 * 「未命名」在「未命名 2」前面），不分大小写；主名相同再比扩展名。
 * Rust 端（fsops.rs 的 natural_cmp）按同样的规则排；前端拿到树以后再排一遍，两端结果一致（中文按字符，不按拼音）。
 */
import type { TreeNode } from "./backend";

const coll = new Intl.Collator("en", { numeric: true, sensitivity: "base" });
const split = (n: string) => { const i = n.lastIndexOf("."); return i > 0 ? [n.slice(0, i), n.slice(i + 1)] : [n, ""]; };

/** 逐段比：数字段按数值，其余按字符（和 Rust 一致，不用拼音排序） */
function chunks(a: string, b: string): number {
  const re = /(\d+)|(\D+)/g;
  const xa = a.toLowerCase().match(re) || [], xb = b.toLowerCase().match(re) || [];
  for (let i = 0; i < Math.min(xa.length, xb.length); i++) {
    const p = xa[i], q = xb[i];
    const dp = /^\d/.test(p), dq = /^\d/.test(q);
    if (dp && dq) { const c = coll.compare(p, q); if (c) return c; continue; }
    if (p !== q) {
      // 非数字段：逐字比，一段是另一段的前缀时短的在前
      for (let k = 0; k < Math.min(p.length, q.length); k++) if (p[k] !== q[k]) return p.charCodeAt(k) < q.charCodeAt(k) ? -1 : 1;
      return p.length - q.length;
    }
  }
  return xa.length - xb.length;
}

export function naturalCompare(a: string, b: string): number {
  const [sa, ea] = split(a), [sb, eb] = split(b);
  return chunks(sa, sb) || chunks(ea, eb);
}

export function sortTree(nodes: TreeNode[]): TreeNode[] {
  return nodes.map((n) => (n.dir ? { ...n, children: sortTree(n.children) } : n))
    .sort((a, b) => (a.dir === b.dir ? naturalCompare(a.name, b.name) : a.dir ? -1 : 1));
}
