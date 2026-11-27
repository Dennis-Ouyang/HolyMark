/**
 * N7 斜杠菜单：行首（或者行首只有空格）输入「/」或中文输入法下的「、」，在光标处弹出插入菜单。
 * - 代码块、公式里不触发；
 * - 边输入边筛选（中文、英文、拼音首字母，见 lib/slashItems.ts），↑↓ 选，回车执行；
 * - Esc 关闭，已经输入的「/…」原样留着；接着输入空格、或者筛不出任何一项（比如「/home 」），自动关闭；
 * - 执行时先删掉「/…」，再交给应用执行同名的菜单命令（命令注册表里的 id），和菜单、⌘K 是同一套操作。
 * 外观和插入文件浮层一样（.ins），从光标处长出来，下面放不下就翻到上方（CodeMirror 的 tooltip 自己会翻）。
 */
import { EditorState, Extension, Prec, StateEffect, StateField } from "@codemirror/state";
import { EditorView, keymap, showTooltip, Tooltip } from "@codemirror/view";
import { filterSlash, SLASH_GROUPS, SlashItem, slashItems, slashQuery } from "../lib/slashItems";
import { iconSvg } from "../lib/icons";
import { keyText, shortcutOf } from "../lib/commandRegistry";
import { insertBlock, tableMarkdown } from "./commands";
import { inCodeBlock } from "./keys";
import { inMath } from "./mathComplete";
import { isReading } from "./readingMode";

export interface SlashHooks {
  /** 执行命令（App 的 onMenu） */
  run: (id: string) => void;
}

interface Slash { at: number; query: string; sel: number; items: SlashItem[]; table?: { r: number; c: number }; tip: Tooltip }

const ALL = slashItems();
const GRID_R = 6, GRID_C = 8;
const setSel = StateEffect.define<number>();
const setTable = StateEffect.define<{ r: number; c: number } | null>();
const close = StateEffect.define<null>();

function compute(state: EditorState, at: number): { query: string } | null {
  const head = state.selection.main;
  if (!head.empty) return null;
  const line = state.doc.lineAt(head.head);
  if (at < line.from || at > head.head) return null;
  const q = slashQuery(line.text, head.head - line.from);
  return q && line.from + q.at === at ? { query: q.query } : null;
}

export const slashField = StateField.define<Slash | null>({
  create: () => null,
  update(v, tr) {
    for (const e of tr.effects) {
      if (e.is(close)) return null;
      if (e.is(setSel) && v) return v.sel === e.value ? v : { ...v, sel: e.value };
      if (e.is(setTable) && v) return { ...v, table: e.value ?? undefined };
    }
    if (v) {
      if (!tr.docChanged && !tr.selection) return v;
      const at = tr.changes.mapPos(v.at, 1);
      const c = compute(tr.state, at);
      if (!c) return null;
      const items = filterSlash(ALL, c.query);
      // 筛不出东西就关掉（输入法正在拼字时不关，拼完再看）
      if (!items.length && !tr.isUserEvent("input.type.compose")) return null;
      const tip = at === v.at ? v.tip : makeTooltip(at);
      return { at, query: c.query, sel: c.query === v.query ? v.sel : 0, items: items.length ? items : v.items, tip };
    }
    // 刚输入了「/」或「、」：行首才弹
    if (!tr.docChanged || !tr.isUserEvent("input")) return null;
    const head = tr.state.selection.main.head;
    const ch = tr.state.sliceDoc(head - 1, head);
    if (ch !== "/" && ch !== "、") return null;
    if (isReading(tr.state) || inCodeBlock(tr.state, head) || inMath(tr.state, head - 1)) return null;
    const c = compute(tr.state, head - 1);
    return c && c.query === "" ? { at: head - 1, query: "", sel: 0, items: ALL, tip: makeTooltip(head - 1) } : null;
  },
  provide: (f) => showTooltip.from(f, (v) => v?.tip ?? null),
});

let hooksRef: () => SlashHooks | undefined = () => undefined;

function insertPickedTable(view: EditorView, r: number, c: number) {
  const v = view.state.field(slashField, false);
  if (!v) return false;
  const head = view.state.selection.main.head;
  view.dispatch({ changes: { from: v.at, to: head }, selection: { anchor: v.at }, effects: close.of(null), userEvent: "delete.slash" });
  insertBlock(view, tableMarkdown(r, c), 2);
  return true;
}

function run(view: EditorView, it: SlashItem | undefined) {
  const v = view.state.field(slashField, false);
  if (!v || !it) return false;
  if (it.id === "insert_table") {
    view.dispatch({ effects: setTable.of({ r: 3, c: 3 }) });
    return true;
  }
  const head = view.state.selection.main.head;
  view.dispatch({ changes: { from: v.at, to: head }, selection: { anchor: v.at }, effects: close.of(null), userEvent: "delete.slash" });
  hooksRef()?.run(it.id);
  return true;
}

function sameItems(a: SlashItem[], b: SlashItem[]) {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i].id !== b[i].id) return false;
  return true;
}

function makeTooltip(pos: number): Tooltip {
  return {
    pos,
    above: false,
    strictSide: false,
    create: (view) => {
      const dom = document.createElement("div");
      dom.className = "ins hm-slash";
      dom.setAttribute("role", "listbox");
      dom.setAttribute("aria-label", "插入");
      dom.addEventListener("mousedown", (e) => e.preventDefault()); // 焦点留在正文里

      let mode: "none" | "list" | "table" = "none";
      let lastItems: SlashItem[] = [];
      let btns: HTMLButtonElement[] = [];
      let cells: { el: HTMLElement; r: number; c: number }[] = [];
      let gridLbl: HTMLElement | null = null;

      const syncSel = (sel: number, scroll: boolean) => {
        btns.forEach((b, i) => {
          const on = i === sel;
          b.classList.toggle("sel", on);
          b.setAttribute("aria-selected", String(on));
        });
        if (scroll) btns[sel]?.scrollIntoView({ block: "nearest" });
      };

      const renderList = (s: Slash) => {
        mode = "list";
        lastItems = s.items;
        btns = [];
        cells = [];
        gridLbl = null;
        dom.classList.remove("grid");
        dom.textContent = "";
        const list = document.createElement("div");
        list.className = "ins-list";
        for (const g of SLASH_GROUPS) {
          const rows = s.items.filter((x) => x.group === g);
          if (!rows.length) continue;
          const gh = document.createElement("div");
          gh.className = "ins-gh";
          gh.textContent = g;
          list.append(gh);
          for (const it of rows) {
            const idx = s.items.indexOf(it);
            const b = document.createElement("button");
            b.type = "button";
            b.className = "ins-row" + (idx === s.sel ? " sel" : "");
            b.setAttribute("role", "option");
            b.setAttribute("aria-selected", String(idx === s.sel));
            const ico = document.createElement("span");
            ico.className = "sl-ico";
            if (/^h\d$/.test(it.icon)) ico.textContent = it.icon.toUpperCase();
            else ico.innerHTML = iconSvg(it.icon, 15);
            const nm = document.createElement("span");
            nm.className = "nm";
            nm.textContent = it.title;
            b.append(ico, nm);
            const k = keyText(shortcutOf(it.id));
            if (k) { const kb = document.createElement("kbd"); kb.className = "sl-key"; kb.textContent = k; b.append(kb); }
            b.addEventListener("mouseenter", () => { if (view.state.field(slashField, false)?.sel !== idx) view.dispatch({ effects: setSel.of(idx) }); });
            b.addEventListener("mousedown", (e) => { e.preventDefault(); e.stopPropagation(); run(view, it); });
            btns[idx] = b;
            list.append(b);
          }
        }
        dom.append(list);
        btns[s.sel]?.scrollIntoView({ block: "nearest" });
      };

      const syncTable = (t: { r: number; c: number }) => {
        if (gridLbl) gridLbl.textContent = `${t.r} 行 × ${t.c} 列`;
        for (const cell of cells) cell.el.classList.toggle("on", cell.r <= t.r && cell.c <= t.c);
      };

      const renderTable = (t: { r: number; c: number }) => {
        mode = "table";
        lastItems = [];
        btns = [];
        cells = [];
        dom.classList.add("grid");
        dom.textContent = "";
        const head = document.createElement("div");
        head.className = "sl-th";
        const back = document.createElement("button");
        back.type = "button";
        back.className = "sl-back";
        back.title = "返回";
        back.setAttribute("aria-label", "返回插入菜单");
        back.innerHTML = iconSvg("back", 14);
        back.addEventListener("mousedown", (e) => { e.preventDefault(); e.stopPropagation(); view.dispatch({ effects: setTable.of(null) }); });
        const title = document.createElement("span");
        title.className = "sl-tt";
        title.textContent = "插入表格";
        gridLbl = document.createElement("span");
        gridLbl.className = "sl-dim num";
        head.append(back, title, gridLbl);

        const grid = document.createElement("div");
        grid.className = "gridpick";
        for (let r = 1; r <= GRID_R; r++) {
          for (let c = 1; c <= GRID_C; c++) {
            const cell = document.createElement("i");
            cell.addEventListener("mouseenter", () => {
              const cur = view.state.field(slashField, false)?.table;
              if (!cur || cur.r !== r || cur.c !== c) view.dispatch({ effects: setTable.of({ r, c }) });
            });
            cell.addEventListener("mousedown", (e) => { e.preventDefault(); e.stopPropagation(); insertPickedTable(view, r, c); });
            cells.push({ el: cell, r, c });
            grid.append(cell);
          }
        }
        const foot = document.createElement("div");
        foot.className = "sl-tf";
        foot.textContent = "点选或按回车插入，Esc 返回";
        dom.append(head, grid, foot);
        syncTable(t);
      };

      const init = view.state.field(slashField, false);
      if (init?.table) renderTable(init.table); else if (init) renderList(init);
      return {
        dom,
        update(u) {
          const s = u.state.field(slashField, false);
          const prev = u.startState.field(slashField, false);
          if (!s || s === prev) return;
          if (s.table) {
            if (mode !== "table") renderTable(s.table);
            else syncTable(s.table);
            return;
          }
          if (mode === "list" && sameItems(lastItems, s.items)) {
            if (!prev || prev.sel !== s.sel) syncSel(s.sel, u.transactions.some((tr) => tr.isUserEvent("select.slash")));
            return;
          }
          renderList(s);
        },
      };
    },
  };
}

const keys = Prec.highest(keymap.of([
  { key: "ArrowDown", run: (view) => move(view, 1, 0) },
  { key: "ArrowUp", run: (view) => move(view, -1, 0) },
  { key: "ArrowRight", run: (view) => move(view, 0, 1) },
  { key: "ArrowLeft", run: (view) => move(view, 0, -1) },
  { key: "Enter", run: (view) => { const v = view.state.field(slashField, false); if (!v) return false; return v.table ? insertPickedTable(view, v.table.r, v.table.c) : run(view, v.items[v.sel]); } },
  { key: "Tab", run: (view) => { const v = view.state.field(slashField, false); if (!v) return false; return v.table ? insertPickedTable(view, v.table.r, v.table.c) : run(view, v.items[v.sel]); } },
  { key: "Escape", run: (view) => { const v = view.state.field(slashField, false); if (!v) return false; view.dispatch({ effects: v.table ? setTable.of(null) : close.of(null) }); return true; } },
]));
function move(view: EditorView, dr: number, dc: number) {
  const v = view.state.field(slashField, false);
  if (!v) return false;
  if (v.table) {
    const r = Math.max(1, Math.min(GRID_R, v.table.r + dr));
    const c = Math.max(1, Math.min(GRID_C, v.table.c + dc));
    view.dispatch({ effects: setTable.of({ r, c }) });
    return true;
  }
  if (!dr) return false;
  view.dispatch({ effects: setSel.of((v.sel + dr + v.items.length) % v.items.length), userEvent: "select.slash" });
  return true;
}

export function slashMenu(hooks: () => SlashHooks | undefined): Extension {
  hooksRef = hooks;
  return [slashField, keys, EditorView.focusChangeEffect.of((_s, focusing) => (focusing ? null : close.of(null)))];
}
