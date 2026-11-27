/**
 * 把网页、Word 复制出来的 HTML 转成 Markdown（G9）。只认常见的结构：标题、段落、加粗、斜体、删除线、
 * 行内代码、代码块、链接、图片（网络地址）、有序 / 无序列表（可嵌套）、引用、表格、分隔线。
 * 样式、字体、颜色、Word 的 mso 标记都丢掉。脚本、样式表不会执行（DOMParser 解析的文档是惰性的）。
 */
const BLOCK = new Set(["P", "DIV", "SECTION", "ARTICLE", "HEADER", "FOOTER", "MAIN", "ASIDE", "NAV", "FIGURE", "H1", "H2", "H3", "H4", "H5", "H6", "UL", "OL", "LI", "BLOCKQUOTE", "PRE", "TABLE", "HR", "BR"]);

const esc = (s: string) => s.replace(/([*_`[\]\\])/g, "\\$1");

function inline(n: Node): string {
  if (n.nodeType === 3) return esc((n.textContent || "").replace(/\s+/g, " "));
  if (n.nodeType !== 1) return "";
  const el = n as HTMLElement;
  const tag = el.tagName;
  const kids = () => [...el.childNodes].map(inline).join("");
  const style = el.getAttribute("style") || "";
  switch (tag) {
    case "STRONG": case "B": { const t = kids().trim(); return t ? `**${t}**` : ""; }
    case "EM": case "I": { const t = kids().trim(); return t ? `*${t}*` : ""; }
    case "S": case "DEL": case "STRIKE": { const t = kids().trim(); return t ? `~~${t}~~` : ""; }
    case "MARK": { const t = kids().trim(); return t ? `==${t}==` : ""; }
    case "SUP": return `^${kids().trim()}^`;
    case "SUB": return `~${kids().trim()}~`;
    case "CODE": return "`" + (el.textContent || "").replace(/`/g, "\\`") + "`";
    case "A": {
      const href = el.getAttribute("href") || "";
      const t = kids().trim();
      if (!href || href.startsWith("#") || /^javascript:/i.test(href)) return t;
      return `[${t || href}](${/[\s()]/.test(href) ? `<${href}>` : href})`;
    }
    case "IMG": {
      const src = el.getAttribute("src") || "";
      return /^https?:/i.test(src) ? `![${el.getAttribute("alt") || ""}](${src})` : "";
    }
    case "BR": return "\n";
    case "SCRIPT": case "STYLE": case "META": case "LINK": case "TITLE": return "";
    case "SPAN": {
      // Word 用带样式的 span 表示加粗、斜体
      let t = kids();
      if (/font-weight:\s*(bold|[6-9]00)/i.test(style) && t.trim()) t = `**${t.trim()}**`;
      if (/font-style:\s*italic/i.test(style) && t.trim()) t = `*${t.trim()}*`;
      return t;
    }
    default: return kids();
  }
}

function block(el: Element, depth = 0): string[] {
  const out: string[] = [];
  let buf = "";
  const flush = () => { const t = buf.replace(/[ \t]+\n/g, "\n").trim(); if (t) out.push(t); buf = ""; };
  for (const n of [...el.childNodes]) {
    if (n.nodeType !== 1 || !BLOCK.has((n as Element).tagName)) { buf += inline(n); continue; }
    const e = n as HTMLElement;
    const tag = e.tagName;
    if (tag === "BR") { buf += "\n"; continue; }
    flush();
    if (/^H[1-6]$/.test(tag)) { const t = inline(e).trim(); if (t) out.push("#".repeat(+tag[1]) + " " + t); }
    else if (tag === "UL" || tag === "OL") out.push(list(e, depth));
    else if (tag === "BLOCKQUOTE") out.push(block(e, depth).join("\n\n").split("\n").map((l) => "> " + l).join("\n"));
    else if (tag === "PRE") out.push("```\n" + (e.textContent || "").replace(/\n$/, "") + "\n```");
    else if (tag === "TABLE") { const t = table(e); if (t) out.push(t); }
    else if (tag === "HR") out.push("---");
    else out.push(...block(e, depth));
  }
  flush();
  return out.filter((x) => x.trim());
}

function list(el: HTMLElement, depth: number): string {
  const ordered = el.tagName === "OL";
  let n = parseInt(el.getAttribute("start") || "1", 10) || 1;
  const lines: string[] = [];
  for (const li of [...el.children].filter((c) => c.tagName === "LI")) {
    const mark = ordered ? `${n++}.` : "-";
    const indent = " ".repeat(depth * (ordered ? 3 : 2));
    const own = [...li.childNodes].filter((c) => !(c.nodeType === 1 && /^(UL|OL)$/.test((c as Element).tagName)));
    const text = own.map(inline).join("").replace(/\s+/g, " ").trim();
    const box = (li.querySelector(":scope > input[type=checkbox]") as HTMLInputElement | null);
    lines.push(`${indent}${mark} ${box ? (box.checked ? "[x] " : "[ ] ") : ""}${text}`);
    for (const sub of [...li.children].filter((c) => /^(UL|OL)$/.test(c.tagName))) lines.push(list(sub as HTMLElement, depth + 1));
  }
  return lines.join("\n");
}

function table(el: HTMLElement): string {
  const rows = [...el.querySelectorAll("tr")].map((tr) => [...tr.children].filter((c) => /^T[DH]$/.test(c.tagName)).map((c) => inline(c).replace(/\|/g, "\\|").replace(/\s+/g, " ").trim()));
  if (!rows.length) return "";
  const n = Math.max(...rows.map((r) => r.length));
  const pad = (r: string[]) => [...r, ...Array(n - r.length).fill("")];
  const line = (r: string[]) => "| " + pad(r).map((c) => c || " ").join(" | ") + " |";
  return [line(rows[0]), "| " + Array(n).fill("---").join(" | ") + " |", ...rows.slice(1).map(line)].join("\n");
}

export function htmlToMarkdown(html: string): string {
  // Word 的条件注释、<o:p> 这类先去掉
  const clean = html.replace(/<!--\[if[\s\S]*?<!\[endif\]-->/gi, "").replace(/<\/?o:p>/gi, "").replace(/<!--[\s\S]*?-->/g, "");
  const doc = new DOMParser().parseFromString(clean, "text/html");
  return block(doc.body).join("\n\n").replace(/\n{3,}/g, "\n\n").trim();
}
