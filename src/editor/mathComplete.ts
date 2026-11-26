/**
 * N12 公式输入补全：在 $…$、$$…$$ 里输入 \ 时弹出常用 LaTeX 命令，右侧画出 KaTeX 渲染后的样子。
 * 带参数的命令插入后光标停在第一个参数里，Tab 跳到下一个。公式以外不触发，不影响正文输入。
 */
import type { EditorState } from "@codemirror/state";
import { syntaxTree } from "@codemirror/language";
import { Completion, CompletionContext, CompletionResult, snippetCompletion } from "@codemirror/autocomplete";
import katex from "katex";
import { inlineMathOpen, TEX, texInsert, texLabel, texPreview, TexItem } from "../lib/latex";
import { mathAt } from "./mathTools";

/** pos 是否在公式里（代码里不算） */
export function inMath(state: EditorState, pos: number): boolean {
  for (let n: { name: string; parent: unknown } | null = syntaxTree(state).resolveInner(pos, -1); n; n = n.parent as typeof n) {
    if (n.name === "InlineCode" || n.name === "FencedCode" || n.name === "CodeBlock") return false;
  }
  if (state.selection.main.head === pos && mathAt(state)) return true;
  const line = state.doc.lineAt(pos);
  return inlineMathOpen(line.text, pos - line.from);
}

type TexCompletion = Completion & { tex: string };
/** 最常用的排在前面 */
const COMMON = new Set("frac sqrt sum int lim alpha beta gamma delta sigma mu lambda pi theta times cdot leq geq neq approx infty partial to Rightarrow in mathbb text mathrm".split(" ").map((x) => "\\" + x));
const options: TexCompletion[] = TEX.filter((t) => t.cmd.startsWith("\\") || /^[a-z]+$/.test(t.cmd)).map((t: TexItem) => {
  const base = { label: texLabel(t), detail: t.info, tex: texPreview(t), type: "math", boost: COMMON.has(t.cmd) ? 10 : 0 };
  return (t.insert ? snippetCompletion(texInsert(t), base) : { ...base, apply: t.cmd }) as TexCompletion;
});

export function mathCompletions(ctx: CompletionContext): CompletionResult | null {
  const m = ctx.matchBefore(/\\[A-Za-z]*/);
  if (!m || !inMath(ctx.state, ctx.pos)) return null;
  return { from: m.from, options, validFor: /^\\[A-Za-z{]*$/ };
}

const rendered = new Map<string, string>();
/** 补全列表每一项右边的小预览 */
export const texPreviewOption = {
  position: 90,
  render(c: Completion) {
    const tex = (c as TexCompletion).tex;
    if (!tex) return null;
    const el = document.createElement("span");
    el.className = "hm-ac-tex";
    let h = rendered.get(tex);
    if (h === undefined) { try { h = katex.renderToString(tex, { throwOnError: false }); } catch { h = ""; } rendered.set(tex, h); }
    el.innerHTML = h;
    return el;
  },
};
