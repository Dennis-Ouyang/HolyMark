/**
 * N6 按章节折叠：标题左边（版心外）悬停出现小三角，点一下把这一节折起来，一直折到下一个同级或更高级的标题之前。
 * 折叠规则用 @codemirror/lang-markdown 自带的 headerIndent（markdown() 里已经装好），这里只接上折叠机制和界面：
 * - 折起来以后，标题后面显示一个安静的占位「已折叠 1,240 字」，点它展开；
 * - 光标（搜索跳转、文内跳转）进入折叠区域时，CodeMirror 自己会展开；
 * - 命令：折叠全部、展开全部、折叠到二级标题；
 * - foldedHeadingLines / restoreFolds 给「记住位置」（N3）用：按标题所在的行号记，不按字符位置。
 */
import { EditorState, Extension, Range } from "@codemirror/state";
import { Decoration, DecorationSet, EditorView, ViewPlugin, ViewUpdate, WidgetType } from "@codemirror/view";
import { codeFolding, ensureSyntaxTree, foldable, foldEffect, foldedRanges, foldState, syntaxTree, unfoldEffect } from "@codemirror/language";
import { countWords, plainText } from "../lib/markdown";
import { iconSvg } from "../lib/icons";

const HEADING = /^ATXHeading(\d)$|^SetextHeading(\d)$/;
const levelOf = (name: string) => { const m = HEADING.exec(name); return m ? +(m[1] || m[2]) : 0; };

/** 某一行开头的标题如果能折叠，返回折叠范围 */
function sectionRange(state: EditorState, lineFrom: number) {
  const line = state.doc.lineAt(lineFrom);
  return foldable(state, line.from, line.to);
}
/** 从 pos（标题行末）开始有没有折起来的范围 */
function foldedAt(state: EditorState, pos: number) {
  let found = false;
  foldedRanges(state).between(pos, pos, (a) => { if (a === pos) found = true; });
  return found;
}
function isFolded(state: EditorState, from: number, to: number) {
  let found = false;
  foldedRanges(state).between(from, to, (a, b) => { if (a === from && b === to) found = true; });
  return found;
}

class ToggleWidget extends WidgetType {
  constructor(readonly folded: boolean) { super(); }
  eq(o: ToggleWidget) { return o.folded === this.folded; }
  toDOM(view: EditorView) {
    const wrap = document.createElement("span");
    wrap.className = "hm-fold-anchor";
    wrap.setAttribute("aria-hidden", "true");
    const b = document.createElement("span");
    b.className = "hm-sfold" + (this.folded ? " folded" : "");
    b.title = this.folded ? "展开这一节" : "折叠这一节";
    b.innerHTML = iconSvg("chev", 12);
    b.addEventListener("mousedown", (e) => {
      e.preventDefault(); e.stopPropagation();
      const r = sectionRange(view.state, view.posAtDOM(wrap));
      if (!r) return;
      view.dispatch({ effects: isFolded(view.state, r.from, r.to) ? unfoldEffect.of(r) : foldEffect.of(r) });
    });
    wrap.appendChild(b);
    return wrap;
  }
  ignoreEvent() { return true; }
}

/** 屏幕上能折叠的标题前面放一个小三角 */
const toggles = ViewPlugin.fromClass(class {
  decorations: DecorationSet;
  constructor(view: EditorView) { this.decorations = this.build(view); }
  update(u: ViewUpdate) {
    if (u.docChanged || u.viewportChanged || syntaxTree(u.startState) !== syntaxTree(u.state) || u.startState.field(foldState, false) !== u.state.field(foldState, false)) this.decorations = this.build(u.view);
  }
  build(view: EditorView) {
    const out: Range<Decoration>[] = [];
    const st = view.state;
    for (const { from, to } of view.visibleRanges) {
      syntaxTree(st).iterate({
        from, to,
        enter: (n) => {
          const lv = levelOf(n.name);
          if (!lv) return n.name === "Document" ? undefined : false;
          // 这里每次按键都会跑：不算整节到哪里结束（一级标题要走遍全文），只看后面紧跟的是不是正文
          const next = n.node.nextSibling;
          if (!next || (levelOf(next.name) && levelOf(next.name) <= lv)) return false;
          const line = st.doc.lineAt(n.from);
          out.push(Decoration.widget({ widget: new ToggleWidget(foldedAt(st, line.to)), side: -1 }).range(line.from));
          return false;
        },
      });
    }
    return Decoration.set(out, true);
  }
}, { decorations: (p) => p.decorations });

/** 折叠占位：「已折叠 1,240 字」 */
export function sectionFolding(withPunct: () => boolean): Extension {
  return [
    codeFolding({
      preparePlaceholder: (state, range) => countWords(plainText(state.sliceDoc(range.from, range.to), false), withPunct()),
      placeholderDOM: (_view, onclick, n: number) => {
        const el = document.createElement("span");
        el.className = "hm-folded";
        el.title = "点一下展开";
        el.textContent = `已折叠 ${n.toLocaleString()} 字`;
        el.addEventListener("click", onclick);
        return el;
      },
    }),
    toggles,
  ];
}

/** 全文的标题：行起点、级别、折叠范围（只算能折叠的） */
function sections(state: EditorState) {
  const tree = ensureSyntaxTree(state, state.doc.length, 2000) ?? syntaxTree(state);
  const out: { line: number; level: number; from: number; to: number }[] = [];
  for (let c = tree.topNode.firstChild; c; c = c.nextSibling) {
    const lv = levelOf(c.name);
    if (!lv) continue;
    const r = sectionRange(state, c.from);
    if (r) out.push({ line: state.doc.lineAt(c.from).number, level: lv, ...r });
  }
  return out;
}

/** 折叠 minLevel 级及更低的所有标题（一层套一层地折：展开外层后里面的小节仍是折着的） */
export function foldHeadings(view: EditorView, minLevel = 1) {
  const effects = sections(view.state).filter((s) => s.level >= minLevel && !isFolded(view.state, s.from, s.to)).map((s) => foldEffect.of({ from: s.from, to: s.to }));
  // 光标在要折起来的地方时先挪到那一节的标题上，免得刚折起来又被自动展开
  const head = view.state.selection.main.head;
  const hit = sections(view.state).filter((s) => s.level >= minLevel && head > s.from && head < s.to)[0];
  view.dispatch({ effects, selection: hit ? { anchor: view.state.doc.line(hit.line).to } : undefined });
}
export function unfoldAll(view: EditorView) {
  const effects: ReturnType<typeof unfoldEffect.of>[] = [];
  foldedRanges(view.state).between(0, view.state.doc.length, (from, to) => { effects.push(unfoldEffect.of({ from, to })); });
  if (effects.length) view.dispatch({ effects });
}
/** 折叠到某一级：比它浅的展开，它和更深的折起来 */
export function foldToLevel(view: EditorView, level: number) {
  unfoldAll(view);
  foldHeadings(view, level);
}

/** 折起来的标题所在的行号（记住位置用） */
export function foldedHeadingLines(state: EditorState): number[] {
  const out: number[] = [];
  foldedRanges(state).between(0, state.doc.length, (from) => { out.push(state.doc.lineAt(from).number); });
  return out;
}
/** 按行号恢复折叠；文件被外部改过、那一行已经不是能折叠的标题时跳过 */
export function restoreFolds(view: EditorView, lines: number[]) {
  const st = view.state;
  const effects = lines.filter((n) => n >= 1 && n <= st.doc.lines).map((n) => sectionRange(st, st.doc.line(n).from)).filter((r): r is { from: number; to: number } => !!r).map((r) => foldEffect.of(r));
  if (effects.length) view.dispatch({ effects });
}
