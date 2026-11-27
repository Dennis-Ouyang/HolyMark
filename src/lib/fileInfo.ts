/** 文件名、大小、时间的显示方式（预览页、右栏用） */

/** 长文件名在中间截断，保住扩展名和区分用的后缀：设计稿-浅色版本-最终-v3.pdf → 设计稿-浅…-v3.pdf */
export function middleTruncate(name: string, max = 28): string {
  const chars = [...name];
  if (chars.length <= max) return name;
  const dot = name.lastIndexOf(".");
  const ext = dot > 0 && name.length - dot <= 8 ? [...name.slice(dot)] : [];
  const stem = chars.slice(0, chars.length - ext.length);
  const keep = Math.max(2, max - ext.length - 1);
  const head = Math.ceil(keep * 0.6), tail = keep - head;
  return stem.slice(0, head).join("") + "…" + stem.slice(stem.length - tail).join("") + ext.join("");
}

export function fmtSize(n: number): string {
  if (n < 1024) return `${n} 字节`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(n < 10 * 1024 ? 1 : 0)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

export function fmtDate(ms: number, now = new Date()): string {
  const d = new Date(ms);
  const hm = `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
  if (d.toDateString() === now.toDateString()) return `今天 ${hm}`;
  const y = d.getFullYear() === now.getFullYear() ? "" : `${d.getFullYear()}年`;
  return `${y}${d.getMonth() + 1}月${d.getDate()}日 ${hm}`;
}
