/** N4 写链接时的提示：在 ](# 后面弹出本文的标题，选中后插入和 Pandoc 一致的锚点。 */
import type { CompletionContext, CompletionResult } from "@codemirror/autocomplete";
import { headingAnchors } from "../lib/anchors";

export function anchorCompletions(ctx: CompletionContext): CompletionResult | null {
  const m = ctx.matchBefore(/\]\(#[^)\s]*/);
  if (!m) return null;
  const from = m.from + 3;
  const hs = headingAnchors(ctx.state.doc.toString());
  if (!hs.length) return null;
  return {
    from,
    options: hs.slice(0, 198).map((h, i) => ({ label: h.text, detail: "#" + h.id, apply: h.id, type: "anchor", boost: 99 - i })), // 没打字时按文中顺序
    filter: true,
  };
}
