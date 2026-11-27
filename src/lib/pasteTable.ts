/**
 * N11 从 Excel、WPS 表格粘贴（纯函数）：剪贴板里的 HTML 表格或制表符分隔的文字 → Markdown 表格。
 * - 第一行作表头；单元格里的 | 转义成 \|，换行写成 <br>；
 * - 合并单元格展开：内容放在左上角那一格，被合并的格子留空（Markdown 表格没有合并）；
 * - 数字列（表头以下非空的格子都是数字：1,234、-3.5、12%、¥30 这类）右对齐，分隔行写 ---:；
 * - 末尾整行、整列都空的去掉。
 */

export type Grid = string[][];

const clean = (s: string) => s.replace(/ /g, " ").replace(/[ \t]+/g, " ").replace(/ *\n */g, "\n").trim();

/** HTML 里的表格 → 二维数组；不是「只有一张表」的内容（网页里夹着表格）返回 null，交给普通的带格式粘贴 */
export function gridFromHtml(html: string): Grid | null {
  if (!/<table[\s>]/i.test(html)) return null;
  const doc = new DOMParser().parseFromString(html.replace(/<!--[\s\S]*?-->/g, ""), "text/html");
  const tables = doc.querySelectorAll("table");
  if (tables.length !== 1) return null;
  const table = tables[0];
  // 表格以外还有文字：不是从表格软件里复制的
  const rest = (doc.body.textContent || "").replace(table.textContent || "", "").trim();
  if (rest) return null;
  const grid: Grid = [];
  const rows = [...table.querySelectorAll("tr")];
  rows.forEach((tr, r) => {
    grid[r] ??= [];
    let c = 0;
    for (const cell of [...tr.children].filter((x) => x.tagName === "TD" || x.tagName === "TH") as HTMLTableCellElement[]) {
      while (grid[r][c] !== undefined) c++;
      // <br> 和块级元素当换行
      const text = clean((cell.innerHTML.replace(/<br\s*\/?>/gi, "\n").replace(/<\/(p|div)>/gi, "\n").replace(/<[^>]+>/g, "")).replace(/&nbsp;/g, " ").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, "&"));
      const cs = Math.max(1, Math.min(50, +(cell.getAttribute("colspan") || 1) || 1));
      const rs = Math.max(1, Math.min(500, +(cell.getAttribute("rowspan") || 1) || 1));
      for (let dr = 0; dr < rs; dr++) {
        if (r + dr >= rows.length) break;
        grid[r + dr] ??= [];
        for (let dc = 0; dc < cs; dc++) grid[r + dr][c + dc] = dr === 0 && dc === 0 ? text : "";
      }
      c += cs;
    }
  });
  return trim(grid.map((row) => Array.from(row, (x) => x ?? "")));
}

/**
 * 制表符分隔的文字 → 二维数组。Excel 会把带换行、制表符、引号的格子用双引号包起来（"a""b" 是 a"b）。
 * 至少两行、而且大多数行有两列以上才算表格（一行里偶尔有个 Tab 的普通文字不算）。
 */
export function gridFromTsv(text: string): Grid | null {
  if (!text.includes("\t")) return null;
  const rows: Grid = [];
  let row: string[] = [], cell = "", i = 0, quoted = false;
  const s = text.replace(/\r\n?/g, "\n").replace(/\n$/, "");
  while (i < s.length) {
    const ch = s[i];
    if (quoted) {
      if (ch === '"' && s[i + 1] === '"') { cell += '"'; i += 2; continue; }
      if (ch === '"') { quoted = false; i++; continue; }
      cell += ch; i++; continue;
    }
    if (ch === '"' && cell === "") { quoted = true; i++; continue; }
    if (ch === "\t") { row.push(cell); cell = ""; i++; continue; }
    if (ch === "\n") { row.push(cell); rows.push(row); row = []; cell = ""; i++; continue; }
    cell += ch; i++;
  }
  row.push(cell); rows.push(row);
  if (rows.length < 2) return null;
  const wide = rows.filter((r) => r.length >= 2).length;
  if (wide < Math.ceil(rows.length * 0.6)) return null;
  return trim(rows.map((r) => r.map(clean)));
}

/** 去掉末尾全空的行和列，各行补齐成一样宽 */
function trim(g: Grid): Grid | null {
  const rows = g.filter((r, i) => r.some((c) => c) || g.slice(i + 1).some((x) => x.some((c) => c)));
  if (!rows.length) return null;
  let n = Math.max(...rows.map((r) => r.length));
  while (n > 0 && rows.every((r) => !r[n - 1])) n--;
  if (n < 1) return null;
  return rows.map((r) => Array.from({ length: n }, (_, k) => r[k] ?? ""));
}

const NUM = /^[-+]?[¥$€£]?\s?(\d{1,3}(,\d{3})+|\d+)(\.\d+)?\s?(%|‰)?$/;
/** 这一列（表头以下）是不是数字列 */
export function isNumericColumn(g: Grid, c: number): boolean {
  const vals = g.slice(1).map((r) => r[c]).filter(Boolean);
  return vals.length > 0 && vals.every((v) => NUM.test(v));
}

const esc = (s: string) => s.replace(/\|/g, "\\|").replace(/\n/g, "<br>");

export function gridToMarkdown(g: Grid): string {
  const n = g[0].length;
  const line = (r: string[]) => "| " + r.map((c) => esc(c) || " ").join(" | ") + " |";
  const sep = "| " + Array.from({ length: n }, (_, c) => (isNumericColumn(g, c) ? "---:" : "---")).join(" | ") + " |";
  return [line(g[0]), sep, ...g.slice(1).map(line)].join("\n");
}

/** 剪贴板 → Markdown 表格；不是表格返回 null。HTML 优先（Excel、WPS 都会放一份），没有再看制表符 */
export function pasteTable(html: string, text: string): string | null {
  const g = (html && gridFromHtml(html)) || gridFromTsv(text);
  return g && (g.length >= 2 || g[0].length >= 2) ? gridToMarkdown(g) : null;
}
