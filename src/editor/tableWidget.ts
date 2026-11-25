/**
 * 可直接编辑的表格。
 * - 单元格平时显示渲染后的内容；点进去显示这一格的 Markdown 源码，离开后再渲染。
 * - 停止输入片刻就把整张表写回文档。写回时保留现有 DOM（见 eq），光标不会丢。
 * - 光标在表格里时，表格上方出现行列工具；「源代码」按钮把整张表切回源码编辑。
 */
import { EditorView, WidgetType } from "@codemirror/view";

export interface TableModel { head: string[]; align: string[]; rows: string[][] }

const splitRow = (l: string) => {
  const t = l.trim().replace(/^\|/, "").replace(/\|$/, "");
  const cells: string[] = [];
  let cur = "";
  for (let i = 0; i < t.length; i++) {
    if (t[i] === "\\" && t[i + 1] === "|") { cur += "\\|"; i++; continue; }
    if (t[i] === "|") { cells.push(cur.trim()); cur = ""; continue; }
    cur += t[i];
  }
  cells.push(cur.trim());
  return cells;
};

export function parseTable(src: string): TableModel {
  const lines = src.split("\n").filter((l) => l.trim());
  const head = splitRow(lines[0] || "");
  const hasAlign = lines[1] && /^\s*\|?\s*:?-{1,}:?\s*(\|\s*:?-{1,}:?\s*)*\|?\s*$/.test(lines[1]);
  const align = hasAlign ? splitRow(lines[1]) : head.map(() => "---");
  const rows = lines.slice(hasAlign ? 2 : 1).map(splitRow);
  const n = Math.max(head.length, ...rows.map((r) => r.length));
  const pad = (r: string[]) => [...r, ...Array(Math.max(0, n - r.length)).fill("")];
  return { head: pad(head), align: [...align, ...Array(Math.max(0, n - align.length)).fill("---")].slice(0, n), rows: rows.map(pad) };
}

export function serializeTable(m: TableModel): string {
  const row = (cells: string[]) => "| " + cells.map((c) => c.replace(/\n/g, " ") || " ").join(" | ") + " |";
  return [row(m.head), "| " + m.align.join(" | ") + " |", ...m.rows.map(row)].join("\n");
}

/** 由表格自己写回的源码：重建装饰时沿用现有 DOM，不重画 */
const selfCommitted = new Set<string>();

export class TableWidget extends WidgetType {
  constructor(readonly src: string, readonly renderInline: (s: string) => string) { super(); }

  eq(other: TableWidget) {
    if (other.src === this.src) return true;
    // 表格自己写回的改动：不论 CodeMirror 从哪一侧比较，都沿用现有 DOM
    // 同一次更新里 CodeMirror 会比较好几次，所以标记保留一小会儿再清掉
    return selfCommitted.has(this.src) || selfCommitted.has(other.src);
  }

  ignoreEvent() { return true; }

  toDOM(view: EditorView) {
    const renderInline = this.renderInline;
    let model = parseTable(this.src);
    let src = this.src;
    let cur = { r: -1, c: -1 };
    let timer = 0;

    const wrap = document.createElement("div");
    wrap.className = "hm-table";
    const tools = document.createElement("div");
    tools.className = "hm-ttools";
    tools.setAttribute("role", "toolbar");
    tools.setAttribute("aria-label", "表格");
    const table = document.createElement("table");
    wrap.append(tools, table);

    const btns: [string, string, () => void][] = [
      ["在上方插入行", "rowAbove", () => edit((m) => { const at = Math.max(0, cur.r - 1); m.rows.splice(at, 0, m.head.map(() => "")); cur.r = at + 1; })],
      ["在下方插入行", "rowBelow", () => edit((m) => { const at = Math.max(0, cur.r); m.rows.splice(at, 0, m.head.map(() => "")); cur.r = at + 1; })],
      ["在左侧插入列", "colLeft", () => edit((m) => { const c = Math.max(0, cur.c); m.head.splice(c, 0, ""); m.align.splice(c, 0, "---"); m.rows.forEach((r) => r.splice(c, 0, "")); })],
      ["在右侧插入列", "colRight", () => edit((m) => { const c = cur.c + 1; m.head.splice(c, 0, ""); m.align.splice(c, 0, "---"); m.rows.forEach((r) => r.splice(c, 0, "")); cur.c = c; })],
      ["删除这一行", "delRow", () => edit((m) => { if (cur.r >= 1 && m.rows.length > 1) { m.rows.splice(cur.r - 1, 1); cur.r = Math.min(cur.r, m.rows.length); } })],
      ["删除这一列", "delCol", () => edit((m) => { if (m.head.length > 1 && cur.c >= 0) { m.head.splice(cur.c, 1); m.align.splice(cur.c, 1); m.rows.forEach((r) => r.splice(cur.c, 1)); cur.c = Math.min(cur.c, m.head.length - 1); } })],
    ];
    for (const [title, icon, run] of btns) tools.appendChild(toolButton(title, icon, run));
    const sep = document.createElement("span");
    sep.className = "sep";
    tools.appendChild(sep);
    const srcBtn = toolButton("显示源代码", "source", () => {
      flush();
      const from = view.posAtDOM(wrap);
      view.focus();
      view.dispatch({ selection: { anchor: from + 2 } });
    });
    srcBtn.classList.add("label");
    srcBtn.insertAdjacentText("beforeend", "源代码");
    tools.appendChild(srcBtn);

    function toolButton(title: string, icon: string, run: () => void) {
      const b = document.createElement("button");
      b.type = "button";
      b.title = title;
      b.setAttribute("aria-label", title);
      b.innerHTML = ICONS[icon];
      b.addEventListener("mousedown", (e) => e.preventDefault());
      b.addEventListener("click", run);
      return b;
    }

    const cellText = (r: number, c: number) => (r === 0 ? model.head[c] : model.rows[r - 1][c]) ?? "";
    const setCell = (r: number, c: number, v: string) => { if (r === 0) model.head[c] = v; else model.rows[r - 1][c] = v; };
    const cellEl = (r: number, c: number) => table.querySelector<HTMLElement>(`[data-r="${r}"][data-c="${c}"]`);

    function render() {
      table.innerHTML = "";
      const all = [model.head, ...model.rows];
      all.forEach((row, r) => {
        const tr = document.createElement("tr");
        row.forEach((_, c) => {
          const td = document.createElement(r === 0 ? "th" : "td");
          td.dataset.r = String(r);
          td.dataset.c = String(c);
          td.contentEditable = "true";
          td.spellcheck = false;
          const a = model.align[c] || "";
          if (/^:-+:$/.test(a)) td.style.textAlign = "center";
          else if (/-:$/.test(a)) td.style.textAlign = "right";
          td.innerHTML = renderInline(cellText(r, c));
          tr.appendChild(td);
        });
        table.appendChild(tr);
      });
    }

    function focusCell(r: number, c: number, atEnd = true) {
      const el = cellEl(r, c);
      if (!el) return;
      el.focus();
      const range = document.createRange();
      range.selectNodeContents(el);
      range.collapse(!atEnd);
      const s = getSelection()!;
      s.removeAllRanges();
      s.addRange(range);
    }

    /** 把模型写回文档 */
    function flush() {
      window.clearTimeout(timer);
      const next = serializeTable(model);
      if (next === src) return;
      const from = view.posAtDOM(wrap);
      if (view.state.sliceDoc(from, from + src.length) !== src) return; // 文档已被别处改动，放弃这次写回
      selfCommitted.add(next);
      window.setTimeout(() => selfCommitted.delete(next), 1000);
      view.dispatch({ changes: { from, to: from + src.length, insert: next } });
      src = next;
    }

    function edit(fn: (m: TableModel) => void) {
      const r = cur.r, c = cur.c;
      if (r >= 0) setCell(r, c, cellEl(r, c)?.textContent ?? cellText(r, c));
      fn(model);
      render();
      flush();
      focusCell(Math.max(0, Math.min(cur.r, model.rows.length)), Math.max(0, Math.min(cur.c, model.head.length - 1)));
    }

    table.addEventListener("focusin", (e) => {
      const td = (e.target as HTMLElement).closest<HTMLElement>("[data-r]");
      if (!td) return;
      cur = { r: +td.dataset.r!, c: +td.dataset.c! };
      td.textContent = cellText(cur.r, cur.c); // 显示这一格的源码
      wrap.classList.add("editing");
    });
    table.addEventListener("focusout", (e) => {
      const td = (e.target as HTMLElement).closest<HTMLElement>("[data-r]");
      if (!td) return;
      const r = +td.dataset.r!, c = +td.dataset.c!;
      setCell(r, c, (td.textContent || "").replace(/\n/g, " ").trim());
      td.innerHTML = renderInline(cellText(r, c));
      if (!wrap.contains(e.relatedTarget as Node)) { wrap.classList.remove("editing"); flush(); }
    });
    table.addEventListener("input", (e) => {
      const td = (e.target as HTMLElement).closest<HTMLElement>("[data-r]");
      if (!td || (e as InputEvent).isComposing) return;
      setCell(+td.dataset.r!, +td.dataset.c!, (td.textContent || "").replace(/\n/g, " "));
      window.clearTimeout(timer);
      timer = window.setTimeout(flush, 500);
    });
    table.addEventListener("keydown", (e) => {
      if (e.isComposing) return;
      const cols = model.head.length, rows = model.rows.length;
      const { r, c } = cur;
      if (e.key === "Tab") {
        e.preventDefault();
        let nr = r, nc = c + (e.shiftKey ? -1 : 1);
        if (nc >= cols) { nc = 0; nr++; }
        if (nc < 0) { nc = cols - 1; nr--; }
        if (nr > rows) { cur = { r, c }; edit((m) => { m.rows.push(m.head.map(() => "")); cur = { r: m.rows.length, c: 0 }; }); return; }
        if (nr >= 0) focusCell(nr, nc);
      } else if (e.key === "Enter") {
        e.preventDefault();
        if (r >= rows) edit((m) => { m.rows.push(m.head.map(() => "")); cur = { r: m.rows.length, c }; });
        else focusCell(r + 1, c);
      } else if (e.key === "Escape" || (e.key === "ArrowDown" && r === rows) || (e.key === "ArrowUp" && r === 0)) {
        e.preventDefault();
        flush();
        const from = view.posAtDOM(wrap);
        const pos = e.key === "ArrowUp" ? Math.max(0, from - 1) : Math.min(view.state.doc.length, from + src.length + 1);
        view.focus();
        view.dispatch({ selection: { anchor: pos }, scrollIntoView: true });
      }
    });
    // 粘贴只取纯文本
    table.addEventListener("paste", (e) => {
      e.preventDefault();
      const t = (e.clipboardData?.getData("text/plain") || "").replace(/\s*\n\s*/g, " ");
      document.execCommand("insertText", false, t);
    });

    render();
    return wrap;
  }
}

const svg = (d: string) => `<svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round">${d}</svg>`;
const ICONS: Record<string, string> = {
  rowAbove: svg('<rect x="2" y="8" width="12" height="5.5" rx="1"/><path d="M8 1.5v5M5.5 4h5"/>'),
  rowBelow: svg('<rect x="2" y="2.5" width="12" height="5.5" rx="1"/><path d="M8 9.5v5M5.5 12h5"/>'),
  colLeft: svg('<rect x="8" y="2" width="5.5" height="12" rx="1"/><path d="M1.5 8h5M4 5.5v5"/>'),
  colRight: svg('<rect x="2.5" y="2" width="5.5" height="12" rx="1"/><path d="M9.5 8h5M12 5.5v5"/>'),
  delRow: svg('<rect x="2" y="5" width="12" height="6" rx="1"/><path d="m6 6.5 4 3M10 6.5l-4 3"/>'),
  delCol: svg('<rect x="5" y="2" width="6" height="12" rx="1"/><path d="m6.5 6 3 4M9.5 6l-3 4"/>'),
  source: svg('<path d="M5.5 4.5 2 8l3.5 3.5M10.5 4.5 14 8l-3.5 3.5"/>'),
};
