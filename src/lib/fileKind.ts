/**
 * 文件类型的小图标容器：30×30（或更小）、圆角、按类型约 8% 的浅底加一圈发丝内描边，里面是同色深字的类型字样或图标。
 * 文件卡片、文件树、插入文件浮层共用这一套（CSS 在 .fbadge）。
 */
import { iconSvg } from "./icons";

export type FileKind = "pdf" | "word" | "excel" | "ppt" | "md" | "image" | "bib" | "zip" | "media" | "code" | "other";

export function fileKind(name: string): FileKind {
  const e = (name.split(".").pop() || "").toLowerCase();
  if (e === "pdf") return "pdf";
  if (/^(docx?|dotx|rtf|odt|pages)$/.test(e)) return "word";
  if (/^(xlsx?|csv|tsv|numbers|ods)$/.test(e)) return "excel";
  if (/^(pptx?|key|odp)$/.test(e)) return "ppt";
  if (/^(md|markdown|txt)$/.test(e)) return "md";
  if (/^(png|jpe?g|gif|webp|svg|bmp|tiff?|heic|avif)$/.test(e)) return "image";
  if (/^(bib|ris|csl)$/.test(e)) return "bib";
  if (/^(zip|rar|7z|gz|tgz|tar)$/.test(e)) return "zip";
  if (/^(mp3|wav|m4a|flac|mp4|mov|mkv|avi|webm)$/.test(e)) return "media";
  if (/^(js|ts|tsx|py|r|json|ya?ml|tex|html?|css|sh)$/.test(e)) return "code";
  return "other";
}

/** 容器里写什么：Office 和 PDF 用字样（一眼认得出），其他用图标 */
const GLYPH: Partial<Record<FileKind, string>> = { pdf: "PDF", word: "W", excel: "X", ppt: "P" };
const ICON: Record<FileKind, string> = { pdf: "pdf", word: "word", excel: "excel", ppt: "ppt", md: "markdown", image: "photo", bib: "bib", zip: "zip", media: "movie", code: "braces", other: "file" };
export const KIND_LABEL: Record<FileKind, string> = { pdf: "PDF", word: "Word 文档", excel: "表格", ppt: "演示文稿", md: "Markdown 文稿", image: "图片", bib: "文献库", zip: "压缩包", media: "音视频", code: "代码", other: "文件" };

/** 图标容器的 HTML（给不是 React 的地方用）；missing 时是中性灰和断开的文件图标 */
export function fileBadgeHTML(name: string, size: "lg" | "sm" = "lg", missing = false) {
  const k = fileKind(name);
  const inner = missing ? iconSvg("fileOff", size === "lg" ? 16 : 13) : GLYPH[k] ? `<b>${GLYPH[k]}</b>` : iconSvg(ICON[k], size === "lg" ? 16 : 13);
  return `<span class="fbadge ${size} k-${missing ? "missing" : k}" aria-hidden="true">${inner}</span>`;
}

/**
 * 中间截断：把名字拆成「前面（可以被省略）」和「后面（总是显示）」两段，
 * 后面一段是主名字的最后几个字加扩展名，长名字省略中间，保住结尾用来区分的部分（「…第三次修订_终版.docx」）。
 */
export function splitMid(name: string, tail = 8): [string, string] {
  const dot = name.lastIndexOf(".");
  const ext = dot > 0 && name.length - dot <= 8 ? name.slice(dot) : "";
  const stem = ext ? name.slice(0, -ext.length) : name;
  if (stem.length <= tail + 2) return [stem, ext];
  return [stem.slice(0, stem.length - tail), stem.slice(-tail) + ext];
}

/** 中间截断的 DOM：<span class="mid"><span class="a">前面</span><span class="b">后面</span></span> */
export function midNameEl(name: string, tail = 8): HTMLElement {
  const [a, b] = splitMid(name, tail);
  const el = document.createElement("span");
  el.className = "mid";
  el.title = name;
  const x = document.createElement("span"); x.className = "a"; x.textContent = a;
  const y = document.createElement("span"); y.className = "b"; y.textContent = b;
  el.append(x, y);
  return el;
}
