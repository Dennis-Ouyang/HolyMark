/**
 * N17 复制为带格式的文字（纯函数部分）：Markdown → 带内联样式的 HTML，粘进别的程序也保持格式。
 * 两种目标：
 *   - word：粘进 Word、邮件；公式用 MathML；
 *   - wechat：粘进公众号编辑器；公式先放占位（<img data-tex>），由界面层画成图片；代码块带底色，空格和换行写死。
 * 批注只留原文；文献引用写成（作者, 年份）；属性区去掉。
 */
import { Marked, Renderer } from "marked";

export type RichTarget = "word" | "wechat";
export interface RichOptions {
  target: RichTarget;
  /** [@key] 显示成什么，例如「张伟, 2021」 */
  citeLabel: (key: string) => string;
  /** 公式：word 目标返回 MathML；wechat 目标不用它（输出占位） */
  math: (tex: string, display: boolean) => string;
  /** 图片地址解析成能显示的地址 */
  resolveImage?: (src: string) => string;
  /** 正文字体（word 目标用） */
  bodyFont?: string;
}

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]!));

const STYLE = {
  word: {
    body: "font-size:12pt;line-height:1.6;color:#000;",
    h: ["font-size:18pt;font-weight:bold;margin:12pt 0 6pt;", "font-size:15pt;font-weight:bold;margin:12pt 0 6pt;", "font-size:13pt;font-weight:bold;margin:10pt 0 4pt;", "font-size:12pt;font-weight:bold;margin:8pt 0 4pt;"],
    p: "margin:0 0 8pt;",
    quote: "margin:0 0 8pt;padding-left:10pt;border-left:3pt solid #ccc;color:#555;",
    pre: "margin:0 0 8pt;padding:6pt 8pt;background:#f5f5f5;font-family:Consolas,Menlo,monospace;font-size:10pt;white-space:pre-wrap;",
    code: "font-family:Consolas,Menlo,monospace;font-size:0.92em;background:#f3f3f3;",
    table: "border-collapse:collapse;margin:0 0 8pt;",
    cell: "border:1px solid #999;padding:4pt 6pt;",
    th: "border:1px solid #999;padding:4pt 6pt;font-weight:bold;background:#f0f0f0;text-align:left;",
    a: "color:#1a56c4;text-decoration:underline;",
    img: "max-width:100%;",
    mark: "background:#fff3a3;",
    math: "margin:6pt 0;text-align:center;",
    cap: "font-size:10.5pt;color:#555;text-align:center;margin:2pt 0 8pt;",
  },
  wechat: {
    body: "font-size:15px;line-height:1.75;color:#333;letter-spacing:0.5px;font-family:-apple-system,BlinkMacSystemFont,'PingFang SC','Microsoft YaHei',sans-serif;",
    h: ["font-size:22px;font-weight:bold;margin:24px 0 12px;color:#222;", "font-size:19px;font-weight:bold;margin:22px 0 10px;color:#222;", "font-size:17px;font-weight:bold;margin:18px 0 8px;color:#222;", "font-size:16px;font-weight:bold;margin:16px 0 8px;color:#222;"],
    p: "margin:0 0 16px;",
    quote: "margin:0 0 16px;padding:8px 14px;border-left:3px solid #d0d4dc;background:#f7f8fa;color:#666;",
    pre: "margin:0 0 16px;padding:12px 14px;background:#f6f8fa;border-radius:6px;font-family:Menlo,Consolas,monospace;font-size:13px;line-height:1.6;color:#333;overflow-x:auto;",
    code: "font-family:Menlo,Consolas,monospace;font-size:0.9em;background:#f3f4f6;padding:1px 4px;border-radius:3px;color:#c7254e;",
    table: "border-collapse:collapse;margin:0 0 16px;width:100%;font-size:14px;",
    cell: "border:1px solid #dfe2e5;padding:6px 10px;",
    th: "border:1px solid #dfe2e5;padding:6px 10px;font-weight:bold;background:#f6f8fa;text-align:left;",
    a: "color:#576b95;text-decoration:none;",
    img: "max-width:100%;display:block;margin:0 auto;",
    mark: "background:#fff3a3;",
    math: "margin:12px 0;text-align:center;",
    cap: "font-size:13px;color:#888;text-align:center;margin:4px 0 16px;",
  },
};

/** 公式、引用这些先换成占位，免得 marked 把 _ * 当成强调 */
function protect(md: string, opts: RichOptions) {
  const slots: string[] = [];
  const put = (html: string) => `HMSLOT${slots.push(html) - 1}X`;
  let s = md;
  // 属性区
  if (s.startsWith("---\n")) { const e = s.indexOf("\n---", 3); if (e > 0) s = s.slice(s.indexOf("\n", e + 4) + 1 || s.length); }
  // 代码块整块保护起来（里面的 $ 不是公式），交给 marked 处理
  const fences: string[] = [];
  s = s.replace(/^(```|~~~)[^\n]*\n[\s\S]*?^\1[ \t]*$/gm, (m) => `HMFENCE${fences.push(m) - 1}X`);
  // 批注只留原文；其他 CriticMarkup：插入保留、删除去掉
  s = s.replace(/\{==([\s\S]+?)==\}\{>>[\s\S]*?<<\}/g, "$1").replace(/\{>>[\s\S]*?<<\}/g, "").replace(/\{\+\+([\s\S]*?)\+\+\}/g, "$1").replace(/\{--[\s\S]*?--\}/g, "").replace(/\{~~[\s\S]*?~>([\s\S]*?)~~\}/g, "$1");
  const st = STYLE[opts.target];
  const math = (tex: string, display: boolean) => {
    const inner = opts.target === "wechat" ? `<img data-tex="${esc(tex)}" data-display="${display ? 1 : 0}" alt="${esc(tex)}">` : opts.math(tex, display);
    return display ? `<div style="${st.math}">${inner}</div>` : inner;
  };
  s = s.replace(/^\$\$\s*\n([\s\S]*?)\n\s*\$\$[ \t]*$/gm, (_m, t) => `\n\n${put(math(t.trim(), true))}\n\n`);
  s = s.replace(/^\$\$(.+?)\$\$[ \t]*$/gm, (_m, t) => `\n\n${put(math(t.trim(), true))}\n\n`);
  s = s.replace(/(?<![\\$`])\$(?!\s)([^$\n]+?)\$(?!\$)/g, (_m, t) => put(math(t, false)));
  s = s.replace(/\[@([^\]]+)\]/g, (_m, keys: string) => put(esc(`（${keys.split(/;\s*/).map((k) => opts.citeLabel(k.replace(/^@/, "").trim())).join("；")}）`)));
  s = s.replace(/==([^=\n]+)==/g, (_m, t) => put(`<mark style="${st.mark}">${esc(t)}</mark>`));
  s = s.replace(/(?<![\^\w])\^([^\^\s]+)\^/g, (_m, t) => put(`<sup>${esc(t)}</sup>`));
  s = s.replace(/(?<!~)~([^~\s]+)~(?!~)/g, (_m, t) => put(`<sub>${esc(t)}</sub>`));
  // 图片后面的 Pandoc 属性 {width=60%} 去掉
  s = s.replace(/(!\[[^\]]*\]\([^)]*\))\{[^}]*\}/g, "$1");
  // 标题末尾的 {#id}
  s = s.replace(/^(#{1,6}\s.*?)\s*\{[#.][^}]*\}\s*$/gm, "$1");
  s = s.replace(/HMFENCE(\d+)X/g, (_m, i) => fences[+i]);
  return { md: s, slots };
}

export function markdownToRichHtml(md: string, opts: RichOptions): string {
  const st = STYLE[opts.target];
  const { md: src, slots } = protect(md, opts);
  const r = new Renderer();
  r.heading = (text, level) => { const tag = `h${Math.min(level, 6)}`; return `<${tag} style="${st.h[Math.min(level, 4) - 1]}">${text}</${tag}>\n`; };
  r.paragraph = (text) => {
    // 只有一张图片的段落：图片 + 图注
    const img = text.match(/^<img [^>]*alt="([^"]*)"[^>]*>$/);
    if (img) return `<p style="${st.p}text-align:center;">${text}</p>${img[1] ? `<p style="${st.cap}">${img[1]}</p>` : ""}\n`;
    if (/^HMSLOT\d+X$/.test(text.trim()) && /^<div/.test(slots[+text.trim().slice(6, -1)])) return text + "\n";
    return `<p style="${st.p}">${text}</p>\n`;
  };
  r.blockquote = (q) => `<blockquote style="${st.quote}">${q.replace(/margin:0 0 (8pt|16px);/g, "margin:0;")}</blockquote>\n`;
  r.code = (code, info) => {
    if ((info || "").trim() === "mermaid") return `<p style="${st.p}color:#888;">[图表]</p>\n`;
    const body = opts.target === "wechat" ? esc(code).replace(/ /g, "&nbsp;").replace(/\n/g, "<br>") : esc(code);
    return `<pre style="${st.pre}"><code>${body}</code></pre>\n`;
  };
  r.codespan = (t) => `<code style="${st.code}">${t}</code>`;
  r.table = (header, body) => `<table style="${st.table}"><thead>${header}</thead><tbody>${body}</tbody></table>\n`;
  r.tablecell = (content, flags) => {
    const tag = flags.header ? "th" : "td";
    const align = flags.align ? `text-align:${flags.align};` : "";
    return `<${tag} style="${flags.header ? st.th : st.cell}${align}">${content}</${tag}>`;
  };
  r.link = (href, _t, text) => `<a href="${esc(href)}" style="${st.a}">${text}</a>`;
  r.image = (href, _t, text) => `<img src="${esc(opts.resolveImage ? opts.resolveImage(href) : href)}" alt="${esc(text)}" style="${st.img}">`;
  r.listitem = (text, task, checked) => `<li>${task ? (checked ? "☑ " : "☐ ") : ""}${text.replace(/^<input[^>]*>\s*/, "")}</li>\n`;
  r.list = (body, ordered, start) => { const tag = ordered ? "ol" : "ul"; return `<${tag}${ordered && start !== 1 ? ` start="${start}"` : ""} style="${st.p}padding-left:2em;">${body}</${tag}>\n`; };
  r.hr = () => `<hr style="border:0;border-top:1px solid #ddd;margin:16px 0;">\n`;
  const m = new Marked({ gfm: true, breaks: false, renderer: r });
  let html = m.parse(src, { async: false }) as string;
  html = html.replace(/HMSLOT(\d+)X/g, (_m, i) => slots[+i]);
  const font = opts.target === "word" && opts.bodyFont ? `font-family:${opts.bodyFont};` : "";
  return `<div style="${st.body}${font}">${html}</div>`;
}
