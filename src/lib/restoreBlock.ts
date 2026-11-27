/**
 * N19 只恢复某一段（纯函数）：在「和现在对比」里，按 alignBlocks 的对齐结果算出要改现在这篇的哪个区间。
 * - 改过的段落：用旧的这一段换回去；
 * - 被删掉的段落：插回原来的位置（跟在它前面那一块后面）；
 * - 新增的段落：删掉。
 */
import { alignBlocks, Row, splitBlocks } from "./markdown";

/** 每一块在全文里的区间：from 是开头，to 是正文的结尾（不含块后面的空行），next 是下一块的开头 */
export interface BlockRange { from: number; to: number; next: number }

export function blockRanges(text: string): BlockRange[] {
  const out: BlockRange[] = [];
  let pos = 0;
  for (const b of splitBlocks(text)) {
    out.push({ from: pos, to: pos + b.replace(/\n+$/, "").length, next: pos + b.length });
    pos += b.length;
  }
  return out;
}

/** 对齐结果，每一行带上右边那一块在现在这篇里的序号（没有就是 -1） */
export interface RangedRow extends Row { ri: number }

export function alignWithRanges(oldText: string, newText: string): RangedRow[] {
  let ri = 0;
  return alignBlocks(oldText, newText).map((r) => ({ ...r, ri: r.right !== null ? ri++ : -1 }));
}

export type BlockFix = { from: number; to: number; insert: string };

/** 恢复这一段（左边有内容的行）：改过的换回去，删掉的插回原位 */
export function restoreRow(newText: string, rows: RangedRow[], i: number): BlockFix | null {
  const r = rows[i];
  if (!r || r.left === null || !r.ops) return null;
  const R = blockRanges(newText);
  if (r.ri >= 0) { const b = R[r.ri]; return { from: b.from, to: b.to, insert: r.left }; }
  // 插回去：跟在前面最近的一块后面；前面没有就放在最前面
  let k = i - 1;
  while (k >= 0 && rows[k].ri < 0) k--;
  if (k < 0) return { from: 0, to: 0, insert: r.left + (newText.trim() ? "\n\n" : "\n") };
  const prev = R[rows[k].ri];
  return { from: prev.to, to: prev.to, insert: "\n\n" + r.left };
}

/** 移除这一段（右边新增的行）：连同后面的空行一起删；是最后一块时连同前面的空行 */
export function removeRow(newText: string, rows: RangedRow[], i: number): BlockFix | null {
  const r = rows[i];
  if (!r || r.right === null || r.left !== null) return null;
  const R = blockRanges(newText);
  const b = R[r.ri];
  if (r.ri === R.length - 1 && r.ri > 0) {
    const tail = newText.slice(b.to).replace(/[^\n]/g, "") ? "\n" : "";
    return { from: R[r.ri - 1].to, to: newText.length, insert: tail };
  }
  return { from: b.from, to: b.next, insert: "" };
}

export const applyFix = (t: string, f: BlockFix) => t.slice(0, f.from) + f.insert + t.slice(f.to);
