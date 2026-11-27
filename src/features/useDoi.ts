/**
 * N21 用 DOI 生成文献条目：联网取 BibTeX（Rust 端请求 doi.org），生成不重复的引用键，
 * 追加到工作区的 .bib（有多个时让用户选，没有就在根目录新建 references.bib），再重新读文献库。
 */
import type { Backend, TreeNode } from "../lib/backend";
import { BibEntry, parseBib } from "../lib/bib";
import { appendEntry, makeKey, setBibKey } from "../lib/doi";
import { baseName, join, relative } from "../lib/paths";
import type { DoiTarget } from "../components/InsertFile";

const flatten = (ns: TreeNode[]): TreeNode[] => ns.flatMap((n) => (n.dir ? flatten(n.children) : [n]));

export function doiTargets(tree: TreeNode[], root: string): DoiTarget[] {
  const bibs = flatten(tree).filter((f) => /\.bib$/i.test(f.name));
  if (bibs.length) return bibs.map((b) => ({ path: b.path, label: root ? relative(root, b.path) : baseName(b.path), isNew: false }));
  return root ? [{ path: join(root, "references.bib"), label: "references.bib（新建）", isNew: true }] : [];
}

export async function addDoiEntry(be: Backend, doi: string, target: DoiTarget, bib: BibEntry[], tree: TreeNode[]): Promise<{ key: string; entries: BibEntry[] }> {
  const raw = await be.fetchDoi(doi);
  const current = target.isNew ? "" : await be.readText(target.path).catch(() => "");
  const key = makeKey(raw, [...bib.map((b) => b.key), ...parseBib(current).map((b) => b.key)]);
  const next = appendEntry(current, setBibKey(raw, key));
  await be.writeText(target.path, next);
  // 重新读所有 .bib，正文里的引用标签跟着更新
  const files = flatten(tree).filter((f) => /\.bib$/i.test(f.name)).map((f) => f.path);
  if (!files.includes(target.path)) files.push(target.path);
  const entries = (await Promise.all(files.map((p) => (p === target.path ? Promise.resolve(next) : be.readText(p).catch(() => ""))))).flatMap(parseBib);
  return { key, entries };
}
