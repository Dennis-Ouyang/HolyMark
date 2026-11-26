/** 极简 BibTeX 解析：只取引用显示需要的作者和年份。 */
export interface BibEntry { key: string; author: string; year: string; title: string }

export function parseBib(src: string): BibEntry[] {
  const out: BibEntry[] = [];
  const re = /@\w+\s*\{\s*([^,\s]+)\s*,([\s\S]*?)\n\}/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(src))) {
    const field = (name: string) => (m![2].match(new RegExp(`${name}\\s*=\\s*[{"]([^}"]*)[}"]`, "i")) || [])[1] || "";
    out.push({ key: m[1], author: field("author"), year: field("year"), title: field("title") });
  }
  return out;
}

/** “张伟 and 王敏” → “张伟”；“Sweller, John” → “Sweller” */
export function shortAuthor(author: string): string {
  const first = author.split(/\s+and\s+/)[0].trim();
  if (first.includes(",")) return first.split(",")[0].trim();
  if (/[一-鿿]/.test(first)) return first;
  const parts = first.split(/\s+/);
  return parts[parts.length - 1];
}

/** 一条引用在正文里怎么写：「张伟，2021」。编辑器和导出预览共用，两边写法一致 */
export function citeOne(b: BibEntry | undefined, key: string): string {
  return b ? `${shortAuthor(b.author)}，${b.year}` : `@${key}`;
}
/** [@a; @b] → 「（张伟，2021；李四，2019）」 */
export function citeText(keys: string[], bib: Map<string, BibEntry>): string {
  return "（" + keys.map((k) => citeOne(bib.get(k), k)).join("；") + "）";
}
