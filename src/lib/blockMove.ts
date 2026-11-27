/**
 * N8 块的移动（纯函数）：把一段文字（一个块，或者标题带着整节）挪到另一个块的前面，块之间保持一个空行。
 * 结果是一处替换（只改动涉及的那一段），编辑器里一次就是一步撤销。
 */

export interface Span { from: number; to: number }
/** 顶层块：from 是第一行行首，to 是最后一行行尾（不含换行）；level 是标题级别，其他块是 0 */
export interface TopBlock extends Span { level: number }

/** to 之后跳过空行，到下一个块的开头（没有就是全文末尾） */
export function nextBlockStart(text: string, to: number): number {
  const re = /\n[ \t]*(?=\n)|\n/y;
  let p = to;
  for (;;) {
    re.lastIndex = p;
    const m = re.exec(text);
    if (!m) break;
    p = re.lastIndex;
  }
  return p >= text.length || !text.slice(p).trim() ? text.length : p;
}

/**
 * 把 [from, to) 挪到 before 前面（before 是某个块的开头，或者全文末尾）。
 * 返回一处替换 { from, to, insert } 和挪过去以后这一段的开头；挪不动（放在自己里面或者原地）返回 null。
 */
export function moveSpan(text: string, unit: Span, before: number): { from: number; to: number; insert: string; at: number } | null {
  const { from, to } = unit;
  const nxt = nextBlockStart(text, to);
  if (before >= from && before <= nxt) return null; // 放在自己里面，或者紧挨在自己后面（原地）
  const body = text.slice(from, to);
  const endNl = text.endsWith("\n") ? "\n" : "";
  if (before < from) {
    const mid = text.slice(before, from).replace(/\s+$/, "");
    const tail = nxt < text.length ? "\n\n" : endNl;
    return { from: before, to: nxt, insert: `${body}\n\n${mid}${tail}`, at: before };
  }
  const mid = text.slice(nxt, before).replace(/\s+$/, "");
  // 挪到全文末尾：原来 unit 前面的空行留着当分隔
  if (before >= text.length) {
    const head = mid ? `${mid}\n\n` : "";
    return { from, to: text.length, insert: `${head}${body}${endNl}`, at: from + head.length };
  }
  return { from, to: before, insert: `${mid}\n\n${body}\n\n`, at: from + mid.length + 2 };
}

/** 标题 i 的整节：从标题到下一个同级或更高级标题之前（最后一个块的行尾） */
export function sectionSpan(blocks: TopBlock[], i: number): Span {
  const L = blocks[i].level;
  let j = i + 1;
  while (j < blocks.length && !(blocks[j].level && blocks[j].level <= L)) j++;
  return { from: blocks[i].from, to: blocks[j - 1].to };
}

/** 拖动或「上移 / 下移」的单位：标题带着整节，其他块就是自己 */
export function unitOf(blocks: TopBlock[], i: number): Span {
  return blocks[i].level ? sectionSpan(blocks, i) : { from: blocks[i].from, to: blocks[i].to };
}

/**
 * 上移 / 下移时放到哪个块前面（返回块的开头或全文末尾的 len；不能挪返回 null）。
 * 普通块：和前一块 / 后一块换位置。标题：和同一个上级下面的前一节 / 后一节换位置。
 */
export function neighborSlot(blocks: TopBlock[], i: number, dir: -1 | 1, len: number): number | null {
  const b = blocks[i];
  if (!b.level) {
    if (dir < 0) return i > 0 ? blocks[i - 1].from : null;
    if (i + 1 >= blocks.length) return null;
    // 往下：越过后面那一块
    return i + 2 < blocks.length ? blocks[i + 2].from : len;
  }
  const L = b.level;
  if (dir < 0) {
    for (let k = i - 1; k >= 0; k--) {
      const lv = blocks[k].level;
      if (lv && lv < L) return null; // 到了上级标题：已经是这一组的第一节
      if (lv === L) return blocks[k].from;
    }
    return null;
  }
  const end = sectionSpan(blocks, i).to;
  const n = blocks.findIndex((x) => x.from > end);
  if (n < 0 || blocks[n].level !== L) return null; // 后面没有同级的下一节
  const after = sectionSpan(blocks, n).to;
  const m = blocks.findIndex((x) => x.from > after);
  return m < 0 ? len : blocks[m].from;
}

/** 落点 before 前面那一块是哪一块（提示条里说「移到 X 之后」） */
export function blockBefore(blocks: TopBlock[], before: number, skip: Span): TopBlock | null {
  let r: TopBlock | null = null;
  for (const b of blocks) {
    if (b.from >= before) break;
    if (b.from >= skip.from && b.to <= skip.to) continue;
    r = b;
  }
  return r;
}
