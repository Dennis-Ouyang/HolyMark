/**
 * 可直接编辑的表格。
 * - 单元格平时显示渲染后的内容；点进去显示这一格的 Markdown 源码，离开后再渲染。
 * - 停止输入片刻就把整张表写回文档。写回时保留现有 DOM（见 eq），光标不会丢。
 * - 悬停或光标在表格里时，表格内部右上角出现工具条：这一列的对齐、行和列（菜单）、源代码。
 * - 数字列（规模、金额、百分比）没指定对齐时默认右对齐、等宽数字。
 * - 拖表头单元格右边缘调列宽，双击恢复自动列宽。
 *   Markdown 表格存不下列宽，这里按 Pandoc 的规则写进分隔行：每列短横线的数量就是它占的比例，
 *   分隔行超过 72 个字符时 Pandoc 按这个比例排 Word / PDF 里的列宽。行高跟着内容走，存不下来。
 */
import { EditorView, WidgetType } from "@codemirror/view";
import { iconSvg } from "../lib/icons";
import { openDomMenu } from "./domMenu";

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

const dashes = (a: string) => (a.match(/-/g) || []).length;
/** 自定义过的列宽（百分比）；分隔行都是 --- 这类短的、一样长的，表示自动列宽，返回 null */
export function columnWidths(m: TableModel): number[] | null {
  const d = m.align.map(dashes);
  const total = d.reduce((a, b) => a + b, 0);
  if (total < 60 || d.every((x) => x === d[0])) return null;
  return d.map((x) => (x / total) * 100);
}
/** 把列宽（百分比）写进分隔行；保留对齐用的冒号。null 表示恢复自动列宽 */
export function setColumnWidths(m: TableModel, pct: number[] | null) {
  m.align = m.align.map((a, i) => {
    const l = a.trim().startsWith(":") ? ":" : "", r = a.trim().endsWith(":") ? ":" : "";
    const n = pct ? Math.max(3, Math.round(pct[i])) : 3;
    return l + "-".repeat(n) + r;
  });
}

/** 数字列：正文里有内容的格子都是数字（规模、金额、百分比），没指定对齐时默认右对齐、等宽数字 */
const NUM = /^[-+−]?[¥$€£]?\s*\d[\d,，.\s]*(%|％|万|亿|元|个|人|次|篇|小时|分钟|天|年)?$/;
export function isNumericColumn(m: TableModel, c: number): boolean {
  const cells = m.rows.map((r) => (r[c] ?? "").trim()).filter(Boolean);
  return cells.length > 0 && cells.every((x) => NUM.test(x));
}
/** 这一列实际的对齐：分隔行里写了冒号就照写的，没写时数字列靠右、其他靠左 */
export function columnAlign(m: TableModel, c: number): "left" | "center" | "right" {
  const a = (m.align[c] || "").trim();
  if (/^:-+:$/.test(a)) return "center";
  if (/-:$/.test(a)) return "right";
  if (/^:-/.test(a)) return "left";
  return isNumericColumn(m, c) ? "right" : "left";
}
/** 设置对齐：写进分隔行的冒号，列宽（短横线的数量）不变 */
export function setColumnAlign(m: TableModel, c: number, how: "left" | "center" | "right") {
  const n = Math.max(3, dashes(m.align[c] || "---"));
  m.align[c] = how === "center" ? ":" + "-".repeat(n) + ":" : how === "right" ? "-".repeat(n) + ":" : ":" + "-".repeat(n);
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
    const stick = document.createElement("div");
    stick.className = "hm-ttools-stick";
    const tools = document.createElement("div");
    tools.className = "hm-ttools";
    tools.setAttribute("role", "toolbar");
    tools.setAttribute("aria-label", "表格");
    stick.appendChild(tools);
    const table = document.createElement("table");
    const scroll = document.createElement("div");
    scroll.className = "hm-tscroll";
    scroll.appendChild(table);
    wrap.append(stick, scroll);

    // 工具条放在表格内部的右上角（悬停或编辑时出现），不再浮在上方盖住上一行正文
    const aligns: ["left" | "center" | "right", string, string][] = [["left", "alignLeft", "左对齐"], ["center", "alignCenter", "居中"], ["right", "alignRight", "右对齐"]];
    const alignBtns = aligns.map(([how, icon, title]) => {
      const b = toolButton(title + "（这一列）", icon, () => edit((m) => setColumnAlign(m, Math.max(0, cur.c), how)));
      b.dataset.align = how;
      tools.appendChild(b);
      return b;
    });
    const sep = document.createElement("span");
    sep.className = "sep";
    tools.appendChild(sep);
    const rowsBtn = toolButton("行和列", "rows", () => {
      rowsBtn.classList.add("open");
      const c = Math.max(0, cur.c);
      openDomMenu(rowsBtn, [
        { label: "在上方插入行", icon: "rowAbove", run: () => edit((m) => { const at = Math.max(0, cur.r - 1); m.rows.splice(at, 0, m.head.map(() => "")); cur.r = at + 1; }) },
        { label: "在下方插入行", icon: "rowBelow", run: () => edit((m) => { const at = Math.max(0, cur.r); m.rows.splice(at, 0, m.head.map(() => "")); cur.r = at + 1; }) },
        { label: "在左侧插入列", icon: "colLeft", run: () => edit((m) => { m.head.splice(c, 0, ""); m.align.splice(c, 0, "---"); m.rows.forEach((r) => r.splice(c, 0, "")); }) },
        { label: "在右侧插入列", icon: "colRight", run: () => edit((m) => { m.head.splice(c + 1, 0, ""); m.align.splice(c + 1, 0, "---"); m.rows.forEach((r) => r.splice(c + 1, 0, "")); cur.c = c + 1; }) },
        { sep: true },
        { label: "删除这一行", icon: "delRow", danger: true, disabled: cur.r < 1 || model.rows.length <= 1, run: () => edit((m) => { if (cur.r >= 1 && m.rows.length > 1) { m.rows.splice(cur.r - 1, 1); cur.r = Math.min(cur.r, m.rows.length); } }) },
        { label: "删除这一列", icon: "delCol", danger: true, disabled: model.head.length <= 1, run: () => edit((m) => { if (m.head.length > 1 && c >= 0) { m.head.splice(c, 1); m.align.splice(c, 1); m.rows.forEach((r) => r.splice(c, 1)); cur.c = Math.min(c, m.head.length - 1); } }) },
      ], { label: "行和列", onClose: () => rowsBtn.classList.remove("open") });
    });
    rowsBtn.classList.add("label");
    rowsBtn.insertAdjacentText("beforeend", "行和列");
    tools.appendChild(rowsBtn);
    const sep2 = document.createElement("span");
    sep2.className = "sep";
    tools.appendChild(sep2);
    const srcBtn = toolButton("显示源代码", "source", () => {
      flush();
      const from = view.posAtDOM(wrap);
      view.focus();
      view.dispatch({ selection: { anchor: from + 2 } });
    });
    srcBtn.classList.add("label");
    srcBtn.insertAdjacentText("beforeend", "源代码");
    tools.appendChild(srcBtn);
    const syncAlign = () => { const how = cur.c >= 0 ? columnAlign(model, cur.c) : ""; alignBtns.forEach((b) => b.classList.toggle("on", b.dataset.align === how)); };
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

    /** 表头单元格右边缘的列宽拖动手柄（最后一列没有） */
    function addGrip(td: HTMLElement, r: number, c: number) {
      if (r !== 0 || c >= model.head.length - 1) return;
      const h = document.createElement("span");
      h.className = "hm-colgrip";
      h.contentEditable = "false";
      h.title = "拖动调整列宽，双击恢复自动列宽";
      h.dataset.c = String(c);
      td.appendChild(h);
    }
    const cellText = (r: number, c: number) => (r === 0 ? model.head[c] : model.rows[r - 1][c]) ?? "";
    const setCell = (r: number, c: number, v: string) => { if (r === 0) model.head[c] = v; else model.rows[r - 1][c] = v; };
    const cellEl = (r: number, c: number) => table.querySelector<HTMLElement>(`[data-r="${r}"][data-c="${c}"]`);

    function render() {
      table.innerHTML = "";
      const widths = columnWidths(model);
      table.classList.toggle("fixed", !!widths);
      if (widths) {
        const cg = document.createElement("colgroup");
        widths.forEach((w) => { const col = document.createElement("col"); col.style.width = w + "%"; cg.appendChild(col); });
        table.appendChild(cg);
      }
      const all = [model.head, ...model.rows];
      all.forEach((row, r) => {
        const tr = document.createElement("tr");
        row.forEach((_, c) => {
          const td = document.createElement(r === 0 ? "th" : "td");
          td.dataset.r = String(r);
          td.dataset.c = String(c);
          td.contentEditable = "true";
          td.spellcheck = false;
          const how = columnAlign(model, c);
          if (how !== "left") td.style.textAlign = how;
          if (r > 0 && isNumericColumn(model, c)) td.classList.add("num");
          td.innerHTML = renderInline(cellText(r, c));
          tr.appendChild(td);
          addGrip(td, r, c);
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

    // 拖动列宽：拖的时候直接改 colgroup，松手后写进分隔行
    table.addEventListener("mousedown", (e) => {
      const grip = (e.target as HTMLElement).closest<HTMLElement>(".hm-colgrip");
      if (!grip) return;
      e.preventDefault();
      e.stopPropagation();
      const c = +grip.dataset.c!;
      const ths = [...table.querySelectorAll<HTMLElement>("tr:first-child > th")];
      const px = ths.map((th) => th.getBoundingClientRect().width);
      const total = px.reduce((a, b) => a + b, 0);
      const startX = e.clientX, a0 = px[c], b0 = px[c + 1];
      let cg = table.querySelector("colgroup");
      if (!cg) { cg = document.createElement("colgroup"); px.forEach(() => cg!.appendChild(document.createElement("col"))); table.prepend(cg); }
      const cols = [...cg.children] as HTMLElement[];
      const apply = () => px.forEach((w, i) => { cols[i].style.width = (w / total) * 100 + "%"; });
      table.classList.add("fixed");
      apply();
      wrap.classList.add("resizing");
      const move = (ev: MouseEvent) => {
        const min = 36, d = Math.max(min - a0, Math.min(b0 - min, ev.clientX - startX));
        px[c] = a0 + d; px[c + 1] = b0 - d;
        apply();
      };
      const up = () => {
        removeEventListener("mousemove", move);
        removeEventListener("mouseup", up);
        wrap.classList.remove("resizing");
        setColumnWidths(model, px.map((w) => (w / total) * 100));
        render();
        flush();
      };
      addEventListener("mousemove", move);
      addEventListener("mouseup", up);
    });
    table.addEventListener("dblclick", (e) => {
      if (!(e.target as HTMLElement).closest(".hm-colgrip")) return;
      e.preventDefault();
      setColumnWidths(model, null);
      render();
      flush();
    });

    table.addEventListener("focusin", (e) => {
      const td = (e.target as HTMLElement).closest<HTMLElement>("[data-r]");
      if (!td) return;
      cur = { r: +td.dataset.r!, c: +td.dataset.c! };
      td.textContent = cellText(cur.r, cur.c); // 显示这一格的源码
      wrap.classList.add("editing");
      syncAlign();
    });
    table.addEventListener("focusout", (e) => {
      const td = (e.target as HTMLElement).closest<HTMLElement>("[data-r]");
      if (!td) return;
      const r = +td.dataset.r!, c = +td.dataset.c!;
      setCell(r, c, (td.textContent || "").replace(/\n/g, " ").trim());
      td.innerHTML = renderInline(cellText(r, c));
      addGrip(td, r, c);
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

const ICONS: Record<string, string> = Object.fromEntries(["alignLeft", "alignCenter", "alignRight", "rows", "source"].map((k) => [k, iconSvg(k, 14)]));
