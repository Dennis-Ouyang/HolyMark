/** 导出对话框里的分页预览：Markdown → HTML，按导出选项排版。分页是近似值。 */
import { marked } from "marked";
import katex from "katex";
import type { BibEntry } from "./bib";
import { shortAuthor } from "./bib";
import { citedKeys, DOCX_HINTS, dropNotes, ExportOptions, fmField, Level, numberHeadings, PAPERS, pageSize, PDF_DEFAULTS, prepareAssets, splitFrontMatter } from "./exporting";
import { fontStack } from "./settings";

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]!));
const NOTE = /\{==([\s\S]+?)==\}\{>>([\s\S]*?)<<\}/g;

export interface PreviewNote { who: string; text: string }
export interface PreviewCtx {
  docDir: string;
  bib: Map<string, BibEntry>;
  /** 图片地址：本地路径 → 能在网页里显示的地址；hm-asset:mermaid-N.png → 渲染好的图 */
  resolveImage: (src: string) => string;
}

/** 在代码块以外的文本上做替换 */
function outsideCode(md: string, f: (s: string) => string): string {
  const parts = md.split(/(^```[\s\S]*?^```[ \t]*$|^~~~[\s\S]*?^~~~[ \t]*$)/m);
  return parts.map((p, i) => (i % 2 ? p : f(p))).join("");
}

function tex(t: string, display: boolean) {
  try { return katex.renderToString(t, { displayMode: display, throwOnError: false, output: "html" }); } catch { return esc(t); }
}

export function previewHTML(src: string, o: ExportOptions, ctx: PreviewCtx): { html: string; notes: PreviewNote[]; title: string } {
  const { fm, body: raw } = splitFrontMatter(src);
  const title = fmField(fm, "title")[0] || "";
  const notes: PreviewNote[] = [];
  let body = numberHeadings(raw, o.H);
  if (o.fmt === "docx" && o.notes === "comment") {
    body = outsideCode(body, (s) => s.replace(NOTE, (_m, q: string, b: string) => {
      const m = b.match(/^@(\S+)\s+\S+?：([\s\S]*)$/);
      notes.push({ who: m ? m[1] : "批注", text: m ? m[2] : b });
      return `<mark class="pv-anno">${esc(q)}</mark>`;
    }));
  } else body = dropNotes(body);
  body = prepareAssets(body, ctx.docDir).body;
  // 图片宽度 {width=60%}：marked 不认属性，借标题传给下面的 renderer.image
  body = outsideCode(body, (s) => s.replace(/(!\[[^\]]*\]\()(<[^>]*>|[^)\s]+)\)\{([^}]*)\}/g, (_m, a: string, h: string, attrs: string) => {
    const w = attrs.match(/(?:^|\s)width=([^\s}]+)/)?.[1];
    return w ? `${a}${h} "hm-w:${w}")` : `${a}${h})`;
  }));
  // 公式、引用先换成 HTML，再交给 marked
  body = outsideCode(body, (s) => s
    .replace(/^\$\$[ \t]*\n([\s\S]*?)\n[ \t]*\$\$[ \t]*$/gm, (_m, t: string) => `<div class="pv-mathb">${tex(t, true)}</div>`)
    .replace(/(^|[^\\$])\$([^$\n]+?)\$/g, (_m, a: string, t: string) => a + tex(t, false))
    .replace(/\[(@[\w:.-]+(?:\s*;\s*@[\w:.-]+)*)\]/g, (_m, inner: string) => {
      const keys = inner.split(";").map((k) => k.trim().slice(1));
      return "（" + keys.map((k) => { const b = ctx.bib.get(k); return b ? `${esc(shortAuthor(b.author))}，${esc(b.year)}` : `@${esc(k)}?`; }).join("；") + "）";
    }));
  // marked 不认 ==高亮==、^上标^、~下标~，先换成 HTML（Pandoc 导出时自己处理）
  body = outsideCode(body, (s) => s
    .replace(/(^|[^{=])==(?=\S)([^=\n]*?\S)==(?![=}])/g, "$1<mark>$2</mark>")
    .replace(/\^([^\s^]+)\^/g, "<sup>$1</sup>")
    .replace(/(^|[^~])~([^\s~]+)~(?!~)/g, "$1<sub>$2</sub>"));
  const renderer = new marked.Renderer();
  renderer.image = (href: string, title: string | null, text: string) => {
    const h = href.replace(/^<|>$/g, "");
    const w = title?.startsWith("hm-w:") ? title.slice(5) : "";
    const style = w ? ` style="width:${esc(/^\d+(\.\d+)?$/.test(w) ? w + "px" : w)}"` : "";
    return `<span class="pv-fig"${style}><img src="${esc(ctx.resolveImage(h))}" alt="">${text ? `<span class="pv-cap">${esc(text)}</span>` : ""}</span>`;
  };
  let html = marked.parse(body, { gfm: true, renderer, async: false }) as string;
  // 只有一张图片的段落：居中，不缩进
  html = html.replace(/<p>(<span class="pv-fig">[\s\S]*?<\/span>)<\/p>/g, '<p class="pv-figp">$1</p>');
  if (o.toc) {
    const hs = [...html.matchAll(/<h([123])[^>]*>([\s\S]*?)<\/h\1>/g)];
    html = `<div class="pv-toc"><h1>目录</h1>${hs.map((h) => `<div class="l${h[1]}">${h[2]}</div>`).join("")}</div>` + html;
  }
  if (title) html = `<div class="pv-title">${esc(title)}</div>` + html;
  const keys = citedKeys(raw).filter((k) => ctx.bib.has(k));
  if (keys.length) {
    const refs = keys.map((k) => ctx.bib.get(k)!).sort((a, b) => a.author.localeCompare(b.author, "zh"));
    html += `<h1 class="pv-refh">参考文献</h1><div class="pv-refs">${refs.map((r) => `<p>${esc(r.author.replace(/\s+and\s+/g, "，"))}. ${r.year}. ${esc(r.title)}.</p>`).join("")}</div>`;
  }
  return { html, notes, title };
}

/** 预览实际使用的版式：没填的字段用参考文档（这里只能近似成 Pandoc 默认参考文档）或 PDF 的默认值 */
export function effective(o: ExportOptions) {
  const pdf = o.fmt === "pdf";
  const D = pdf ? PDF_DEFAULTS : DOCX_HINTS;
  const v = (x: string, d: string) => (x.trim() ? +x : +d);
  const [pw, ph] = pageSize(o) || PAPERS[D.paper];
  const size = v(o.size, D.size);
  const fixed = o.lsMode === "fixed" && o.ls.trim();
  const lineHeight = fixed ? `${+o.ls}pt` : String(v(o.ls, D.ls) * 1.3);
  const bodyFonts = [o.latin || (pdf ? PDF_DEFAULTS.latin : ""), o.cjk || (pdf ? PDF_DEFAULTS.cjk : "")].filter(Boolean);
  const family = bodyFonts.length ? bodyFonts.map((f) => fontStack(f).split(",")[0]).join(",") + "," + fontStack(bodyFonts[bodyFonts.length - 1]) : fontStack("");
  const heads = (["1", "2", "3"] as Level[]).map((l) => {
    const h = o.H[l];
    return {
      size: v(h.size, D.H[l].size),
      family: h.font ? fontStack(h.font) : "inherit",
      weight: h.bold === "1" ? 700 : h.bold === "0" ? 400 : pdf ? 700 : 400,
      align: h.align || "left",
      before: v(h.before, pdf ? String(size * 1.2) : ["18", "8", "8"][+l - 1]),
      after: v(h.after, pdf ? String(size * 0.6) : "4"),
      color: h.color === "black" || pdf ? "#111" : "#0F4761",
    };
  });
  return {
    pw, ph,
    margins: [v(o.mt, D.mt), v(o.mb, D.mb), v(o.ml, D.ml), v(o.mr, D.mr)],
    size, lineHeight, family,
    indent: v(o.indent, D.indent), before: v(o.before, D.before), after: v(o.after, D.after),
    align: o.align || (pdf ? "justify" : "left"),
    heads,
  };
}
