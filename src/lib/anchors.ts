/**
 * 标题锚点：规则和 Pandoc 默认的 auto_identifiers 一致，导出到 Word、PDF 后文内链接也能用。
 * Pandoc 的做法（Text.Pandoc.Shared.inlineListToIdentifier）：
 *   转小写 → 只留字母、数字、_ - . 和空白 → 按空白切词再用 - 连起来 → 去掉第一个字母之前的所有字符 → 空了就用 section。
 * 汉字算字母；全角空格也是空白。同名的标题依次加 -1、-2。写了 {#id} 的用它自己的。
 */
import { headings, HEADING_ATTR } from "./markdown";
export { HEADING_ATTR };

const ALLOWED = /[\p{L}\p{N}\p{M}_.\-\s]/u;

export function pandocId(text: string): string {
  // Pandoc 默认开着 smart：--、---、... 先变成破折号、省略号，随后被当成标点去掉
  const kept = [...text.replace(/-{2,3}|\.\.\./g, "").toLowerCase()].filter((c) => ALLOWED.test(c)).join("");
  const joined = kept.split(/\s+/u).filter(Boolean).join("-");
  const i = [...joined].findIndex((c) => /\p{L}/u.test(c));
  return i < 0 ? "" : [...joined].slice(i).join("");
}


export interface HeadingAnchor { level: number; text: string; pos: number; id: string }

/** 全文标题和它们的锚点，按出现顺序 */
export function headingAnchors(md: string): HeadingAnchor[] {
  const used = new Map<string, number>();
  return headings(md).map((h) => {
    const exp = h.attrId ?? null;
    const text = h.text;
    let id = exp ?? (pandocId(text) || "section");
    if (!exp) {
      const n = used.get(id);
      if (n !== undefined) { used.set(id, n + 1); id = `${id}-${n + 1}`; }
      else used.set(id, 0);
    }
    return { level: h.level, text, pos: h.pos, id };
  });
}

/** 按锚点找标题：先精确匹配，再按标题文字本身（有人直接写 #样本与数据 的原文），最后忽略大小写、空格和连字符 */
export function findAnchor(md: string, anchor: string): HeadingAnchor | null {
  const all = headingAnchors(md);
  const a = anchor.trim();
  const loose = (x: string) => x.toLowerCase().replace(/[\s\-_]+/g, "");
  return all.find((h) => h.id === a) ?? all.find((h) => h.id === pandocId(a)) ?? all.find((h) => h.text.trim() === a)
    ?? all.find((h) => loose(h.text) === loose(a)) ?? null;
}
