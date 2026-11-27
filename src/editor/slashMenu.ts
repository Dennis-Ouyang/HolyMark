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
import { inCodeBlock } from "./keys";
import { inMath } from "./mathComplete";
import { isReading } from "./readingMode";

export interface SlashHooks {
  /** 执行命令（App 的 onMenu） */
  run: (id: string) => void;
}

interface Slash { at: number; query: string; sel: number; items: SlashItem[] }

const ALL = slashItems();
const setSel = StateEffect.define<number>();
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
      if (e.is(setSel) && v) return { ...v, sel: e.value };
    }
    if (v) {
      if (!tr.docChanged && !tr.selection) return v;
      const at = tr.changes.mapPos(v.at, 1);
      const c = compute(tr.state, at);
      if (!c) return null;
      const items = filterSlash(ALL, c.query);
      // 筛不出东西就关掉（输入法正在拼字时不关，拼完再看）
      if (!items.length && !tr.isUserEvent("input.type.compose")) return null;
      return { at, query: c.query, sel: c.query === v.query ? v.sel : 0, items: items.length ? items : v.items };
    }
    // 刚输入了「/」或「、」：行首才弹
    if (!tr.docChanged || !tr.isUserEvent("input")) return null;
    const head = tr.state.selection.main.head;
    const ch = tr.state.sliceDoc(head - 1, head);
    if (ch !== "/" && ch !== "、") return null;
    if (isReading(tr.state) || inCodeBlock(tr.state, head) || inMath(tr.state, head - 1)) return null;
    const c = compute(tr.state, head - 1);
    return c && c.query === "" ? { at: head - 1, query: "", sel: 0, items: ALL } : null;
  },
  provide: (f) => showTooltip.from(f, (v) => (v ? tooltip(v) : null)),
});

let hooksRef: () => SlashHooks | undefined = () => undefined;

function run(view: EditorView, it: SlashItem | undefined) {
  const v = view.state.field(slashField, false);
  if (!v || !it) return false;
  const head = view.state.selection.main.head;
  view.dispatch({ changes: { from: v.at, to: head }, selection: { anchor: v.at }, effects: close.of(null), userEvent: "delete.slash" });
  hooksRef()?.run(it.id);
  return true;
}

function tooltip(v: Slash): Tooltip {
  return {
    pos: v.at,
    above: false,
    strictSide: false,
    create: (view) => {
      const dom = document.createElement("div");
      dom.className = "ins hm-slash";
      dom.setAttribute("role", "listbox");
      dom.setAttribute("aria-label", "插入");
      dom.addEventListener("mousedown", (e) => e.preventDefault()); // 焦点留在正文里
      const render = (s: Slash) => {
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
            b.addEventListener("mousemove", () => { if (view.state.field(slashField, false)?.sel !== idx) view.dispatch({ effects: setSel.of(idx) }); });
            b.addEventListener("click", () => run(view, it));
            list.append(b);
          }
        }
        dom.append(list);
        list.querySelector(".sel")?.scrollIntoView({ block: "nearest" });
      };
      render(v);
      return {
        dom,
        update(u) {
          const s = u.state.field(slashField, false);
          if (s && (s !== u.startState.field(slashField, false))) render(s);
        },
      };
    },
  };
}

const keys = Prec.highest(keymap.of([
  { key: "ArrowDown", run: (view) => move(view, 1) },
  { key: "ArrowUp", run: (view) => move(view, -1) },
  { key: "Enter", run: (view) => { const v = view.state.field(slashField, false); return v ? run(view, v.items[v.sel]) : false; } },
  { key: "Tab", run: (view) => { const v = view.state.field(slashField, false); return v ? run(view, v.items[v.sel]) : false; } },
  { key: "Escape", run: (view) => { if (!view.state.field(slashField, false)) return false; view.dispatch({ effects: close.of(null) }); return true; } },
]));
function move(view: EditorView, d: number) {
  const v = view.state.field(slashField, false);
  if (!v) return false;
  view.dispatch({ effects: setSel.of((v.sel + d + v.items.length) % v.items.length) });
  return true;
}

export function slashMenu(hooks: () => SlashHooks | undefined): Extension {
  hooksRef = hooks;
  return [slashField, keys, EditorView.focusChangeEffect.of((_s, focusing) => (focusing ? null : close.of(null)))];
}
