/** N21 用 DOI 生成文献条目（纯函数）：认出 DOI、生成不重复的引用键、改写 BibTeX 里的键。 */

/** 10.1207/s15516709cog1202_4、doi:10.…、https://doi.org/10.…、https://dx.doi.org/10.… → 10.… */
export function parseDoi(input: string): string | null {
  let s = input.trim().replace(/^[`"'<(\[【「]+/, "").replace(/[`"'>)\]】」]+$/, "").trim();
  try { s = decodeURIComponent(s); } catch { /* 原样用 */ }
  const m = s.match(/^(?:doi:\s*|https?:\/\/(?:dx\.)?doi\.org\/)?(10\.\d{4,9}\/\S+)$/i);
  return m ? m[1].replace(/[.,;。，；]+$/, "") : null;
}

/** BibTeX 里某个字段的值（去掉外层括号） */
export function bibField(bib: string, name: string): string {
  const m = bib.match(new RegExp(`(?:^|[,\\s])${name}\\s*=\\s*(\\{((?:[^{}]|\\{[^{}]*\\})*)\\}|"([^"]*)"|(\\d+))`, "i"));
  return m ? (m[2] ?? m[3] ?? m[4] ?? "").replace(/[{}]/g, "").trim() : "";
}

/** 引用键：第一作者的姓（只留英文字母，转小写；没有就用 ref）+ 年份；和已有的重复时加 a、b、c… */
export function makeKey(bib: string, existing: Iterable<string>): string {
  const author = bibField(bib, "author").split(/\s+and\s+/i)[0] || "";
  const family = author.includes(",") ? author.split(",")[0] : author.split(/\s+/).pop() || "";
  const ascii = family.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z]/g, "");
  const base = (ascii || "ref") + (bibField(bib, "year").match(/\d{4}/)?.[0] ?? "");
  const taken = new Set([...existing].map((k) => k.toLowerCase()));
  if (!taken.has(base)) return base;
  for (let i = 0; i < 26 * 27; i++) {
    const suffix = i < 26 ? String.fromCharCode(97 + i) : String.fromCharCode(96 + Math.floor(i / 26)) + String.fromCharCode(97 + (i % 26));
    if (!taken.has(base + suffix)) return base + suffix;
  }
  return base + Date.now();
}

/** 把 @article{原来的键, 换成新的键，整理一下首尾空白 */
export function setBibKey(bib: string, key: string): string {
  return bib.trim().replace(/^@(\w+)\s*\{\s*[^,\s]*\s*,/, `@$1{${key},`);
}

/** 追加到 .bib 文件末尾：和前面的条目之间空一行 */
export function appendEntry(file: string, entry: string): string {
  const head = file.replace(/\s*$/, "");
  return (head ? head + "\n\n" : "") + entry.trim() + "\n";
}
