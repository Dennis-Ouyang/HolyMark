/**
 * Tab 的行为：列表里调层级（commands.ts 的 indentList），代码块里缩进，其他地方不插空格。
 * 段首插 4 个空格在 Markdown 里会变成代码块（导出成等宽字体），而 Word 用户习惯按 Tab 做首行缩进，
 * 所以普通段落里按 Tab 什么都不做，第一次按时用提示条说明首行缩进在哪里调。
 */
import { indentLess, indentMore } from "@codemirror/commands";
import { syntaxTree } from "@codemirror/language";
import type { EditorState } from "@codemirror/state";
import type { SyntaxNode } from "@lezer/common";
import type { EditorView, KeyBinding } from "@codemirror/view";
import { indentList } from "./commands";
import { notifyOnce } from "./notice";

/** 光标在围栏代码块（``` 之间）里 */
export function inCodeBlock(state: EditorState, pos: number) {
  for (let n: SyntaxNode | null = syntaxTree(state).resolveInner(pos, -1); n; n = n.parent) {
    if (n.name === "FencedCode" || n.name === "CodeBlock") return true;
  }
  return false;
}

export function tabKey(view: EditorView, dir: 1 | -1) {
  if (indentList(view, dir)) return true;
  if (inCodeBlock(view.state, view.state.selection.main.head)) return dir === 1 ? indentMore(view) : indentLess(view);
  if (dir === 1) notifyOnce("tab-indent", "在正文中按 Tab 并不会缩进。导出文件的缩进显示格式可以在导出设置中的「正文」部分调整。");
  return true;
}

export const tabKeymap: KeyBinding[] = [
  { key: "Tab", run: (v) => tabKey(v, 1) },
  { key: "Shift-Tab", run: (v) => tabKey(v, -1) },
];
