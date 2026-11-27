/**
 * 前端的路径一律用正斜杠：Rust 端把 Windows 的 C:\a\b 转成 C:/a/b 再交过来，
 * 前端拼出来的路径交回 Rust 时，Windows 也认正斜杠。
 */

/** 反斜杠换成正斜杠（只用于来自系统对话框等、可能带反斜杠的 Windows 路径） */
export function toPosix(p: string): string {
  return /^[A-Za-z]:\\|^\\\\/.test(p) ? p.replace(/\\/g, "/") : p;
}

const DRIVE = /^[A-Za-z]:$/;

/** 所在目录。盘符根目录保留结尾的斜杠（C:/），否则 Windows 会理解成「C 盘的当前目录」 */
export function dirOf(p: string): string {
  const d = p.replace(/\/[^/]*$/, "");
  if (DRIVE.test(d)) return d + "/";
  return d === p ? "" : d || "/";
}

export function baseName(p: string): string {
  return p.split("/").pop() || p;
}

export function join(dir: string, name: string): string {
  return dir.replace(/\/+$/, "") + "/" + name.replace(/^\/+/, "");
}

/** 把 a/b/../c 规范化；保留开头的 /、// （网络路径）或盘符 */
export function normalize(p: string): string {
  const lead = p.startsWith("//") ? "//" : p.startsWith("/") ? "/" : "";
  const out: string[] = [];
  for (const part of p.split("/")) {
    if (part === "..") { if (out.length && !DRIVE.test(out[out.length - 1])) out.pop(); }
    else if (part !== "." && part !== "") out.push(part);
  }
  return lead + out.join("/");
}

/** Windows 的路径（带盘符或网络路径）不分大小写 */
const isWin = (p: string) => /^[A-Za-z]:|^\/\//.test(p);
const same = (a: string, b: string, win: boolean) => a === b || (win && a.toLowerCase() === b.toLowerCase());

/** to 相对 fromDir 的路径 */
export function relative(fromDir: string, to: string): string {
  const a = fromDir.split("/").filter(Boolean), b = to.split("/").filter(Boolean);
  const win = isWin(fromDir);
  let i = 0;
  while (i < a.length && i < b.length && same(a[i], b[i], win)) i++;
  return [...a.slice(i).map(() => ".."), ...b.slice(i)].join("/") || ".";
}

/** p 是否在 root 文件夹里面 */
export function isInside(root: string, p: string): boolean {
  if (!root) return false;
  const r = root.replace(/\/+$/, "") + "/";
  return same(p.slice(0, r.length), r, isWin(root));
}

/** Markdown 文稿：.md 或 .markdown，不分大小写 */
export const MD_EXT = /\.(md|markdown)$/i;
export const isMarkdown = (name: string) => MD_EXT.test(name);
/** 去掉 Markdown 扩展名（给人看的名字） */
export const stripMd = (name: string) => name.replace(MD_EXT, "");
