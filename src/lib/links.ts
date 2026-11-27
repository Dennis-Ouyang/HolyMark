/** 正文里的链接指向哪里：网页、本文的锚点、另一篇 Markdown（可带锚点）、其他文件。 */
import { dirOf, join, normalize, toPosix } from "./paths";

export type LinkTarget =
  | { kind: "url"; url: string }
  | { kind: "anchor"; anchor: string }
  | { kind: "md"; path: string; anchor: string }
  | { kind: "file"; path: string };

export function resolveHref(href: string, docPath: string): LinkTarget | null {
  let h = href.trim().replace(/^<(.*)>$/, "$1");
  if (!h) return null;
  if (/^(https?|mailto|ftp):/i.test(h)) return { kind: "url", url: h };
  if (/^www\./i.test(h)) return { kind: "url", url: "https://" + h };
  if (/^[a-z][a-z0-9+.-]*:/i.test(h) && !/^[A-Za-z]:[\\/]/.test(h) && !/^file:/i.test(h)) return null; // 不认识的协议不打开
  h = h.replace(/^file:\/\//i, "");
  let anchor = "";
  const hash = h.indexOf("#");
  if (hash >= 0) { anchor = h.slice(hash + 1); h = h.slice(0, hash); }
  try { anchor = decodeURIComponent(anchor); } catch { /* 原样用 */ }
  if (!h) return { kind: "anchor", anchor };
  try { h = decodeURI(h); } catch { /* 原样用 */ }
  const abs = /^(\/|[A-Za-z]:[\\/])/.test(h) ? toPosix(h) : normalize(join(dirOf(docPath), h));
  if (/\.(md|markdown)$/i.test(abs)) return { kind: "md", path: abs, anchor };
  return { kind: "file", path: abs };
}
