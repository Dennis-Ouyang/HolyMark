/**
 * N17 导出 HTML（纯函数）：Pandoc 生成单个自包含的 HTML（--embed-resources --standalone，公式 --mathml），
 * 样式和 HolyMark 的阅读版式一致（字号、行距、版心宽度跟导出选项走），深色跟随系统。
 * 批注和 Word 导出一致（exporting.ts 的 notesToHtml）：选「变成批注」时原文浅底标出、悬停看批注；选「不导出」时只留原文。
 * 文献按 CSL 排（citeproc）。
 */
import type { ExportOptions } from "./exporting";

const px = (v: string, d: number) => { const n = parseFloat(v); return Number.isFinite(n) && n > 0 ? n : d; };
const font = (f: string, fallback: string) => (f ? `"${f.replace(/"/g, "")}", ${fallback}` : fallback);

/** 阅读版式的样式表。字号按 pt 换成 px（12pt = 16px），行距倍数、首行缩进照导出选项 */
export function htmlCss(o: Pick<ExportOptions, "size" | "ls" | "lsMode" | "indent" | "cjk" | "latin" | "align">): string {
  const size = Math.round(px(o.size, 12) * 4 / 3 * 10) / 10;
  const lh = o.lsMode === "multi" ? px(o.ls, 1.75) : 1.75;
  const sans = `-apple-system, "PingFang SC", "Microsoft YaHei", "Noto Sans SC", sans-serif`;
  const body = font([o.latin, o.cjk].filter(Boolean).join('", "'), sans);
  const indent = parseFloat(o.indent) > 0 ? `${parseFloat(o.indent)}em` : "0";
  return `/* HolyMark 阅读版式：浅色、深色跟随系统 */
:root { color-scheme: light dark; --bg: #fff; --fg: #1d1f24; --fg-2: #5a5f6b; --fg-3: #8a8f99; --line: #e6e7eb; --code-bg: #f6f7f9; --accent: #4f56d6; --note-bg: rgba(79, 86, 214, .10); --mark-bg: rgba(242, 190, 34, .28); }
@media (prefers-color-scheme: dark) { :root { --bg: #0f1014; --fg: #e7e8ec; --fg-2: #a2a5b0; --fg-3: #6a6e7a; --line: #2d3039; --code-bg: #121318; --accent: #9aa0f7; --note-bg: rgba(125, 132, 244, .18); --mark-bg: rgba(242, 190, 34, .24); } }
html { background: var(--bg); }
body { max-width: 40em; margin: 0 auto; padding: 56px 24px 96px; font-family: ${body}; font-size: ${size}px; line-height: ${lh}; color: var(--fg); background: var(--bg); text-align: ${o.align === "justify" ? "justify" : "start"}; -webkit-font-smoothing: antialiased; }
p { margin: 0 0 .9em; text-indent: ${indent}; }
h1, h2, h3, h4, h5, h6 { line-height: 1.3; margin: 1.6em 0 .6em; font-weight: 650; text-indent: 0; }
h1 { font-size: 1.75em; } h2 { font-size: 1.4em; } h3 { font-size: 1.18em; } h4, h5, h6 { font-size: 1em; }
header#title-block-header { margin-bottom: 2.4em; } .title { font-size: 2em; margin: 0; } .subtitle, .author, .date { color: var(--fg-2); margin: .3em 0 0; text-indent: 0; }
a { color: var(--accent); text-decoration: none; border-bottom: 1px solid color-mix(in srgb, var(--accent) 35%, transparent); }
blockquote { margin: 1em 0; padding: 0 0 0 1em; border-left: 3px solid var(--line); color: var(--fg-2); }
code { font-family: "SF Mono", Menlo, Consolas, monospace; font-size: .88em; background: var(--code-bg); padding: .1em .35em; border-radius: 4px; }
pre { background: var(--code-bg); padding: 12px 16px; border-radius: 8px; overflow-x: auto; line-height: 1.55; }
pre code { background: none; padding: 0; }
table { border-collapse: collapse; margin: 1.2em 0; width: 100%; border-top: 1.5px solid var(--fg); border-bottom: 1.5px solid var(--fg); font-variant-numeric: tabular-nums; }
th { border-bottom: 1px solid var(--fg); font-weight: 600; } th, td { padding: 6px 10px; text-align: left; }
img { max-width: 100%; height: auto; display: block; margin: 0 auto; } figure { margin: 1.4em 0; text-align: center; } figcaption { color: var(--fg-2); font-size: .9em; margin-top: .4em; }
math[display="block"] { margin: 1em 0; overflow-x: auto; }
mark { background: var(--mark-bg); color: inherit; padding: 0 .1em; border-radius: 2px; }
hr { border: 0; border-top: 1px solid var(--line); margin: 2em 0; }
nav#TOC { margin: 0 0 2em; padding: 12px 16px; border: 1px solid var(--line); border-radius: 8px; } nav#TOC h2 { margin: 0 0 .3em; font-size: 1em; color: var(--fg-2); } nav#TOC ul { padding-left: 1.2em; margin: .2em 0; }
.footnotes, #refs { font-size: .92em; color: var(--fg-2); } .csl-entry { margin-bottom: .5em; padding-left: 2em; text-indent: -2em; }
.hm-note { background: var(--note-bg); border-radius: 2px; cursor: help; position: relative; }
.hm-note:hover::after { content: attr(data-note); position: absolute; left: 0; top: calc(100% + 4px); z-index: 2; width: max-content; max-width: 22em; padding: 6px 10px; border-radius: 8px; background: var(--bg); color: var(--fg); box-shadow: 0 0 0 .5px var(--line), 0 6px 16px rgba(0, 0, 0, .12); font-size: .85em; line-height: 1.5; text-indent: 0; white-space: normal; }
@media print { body { max-width: none; padding: 0; } .hm-note { background: none; } }
`;
}
