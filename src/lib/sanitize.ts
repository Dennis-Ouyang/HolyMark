/**
 * 清洗要插进页面的 HTML（导出预览等）。
 * 文稿里可能带原始 HTML（比如从网上下载的 .md），marked 原样输出；桌面版里页面能调 Tauri 命令，
 * 所以插进页面之前必须去掉脚本、事件处理器和 javascript: 地址。
 * 程序自己生成的 KaTeX（span、svg、style 属性）、pv-* 类名、图片要保留。
 */
import DOMPurify, { type Config, type DOMPurify as Purifier, type WindowLike } from "dompurify";

/** 允许的地址：网页、邮件、页内锚点、相对路径，以及图片用的 asset:、data:、blob: */
const URI = /^(?:(?:https?|mailto|tel|asset|blob):|data:image\/|[^a-z]|[a-z+.-]+(?:[^a-z+.\-:]|$))/i;

const CONFIG: Config = {
  ALLOWED_URI_REGEXP: URI,
  // 表单、嵌入、框架一律不要；svg 只为 KaTeX 的根号、箭头这类图形保留
  FORBID_TAGS: ["script", "style", "iframe", "frame", "frameset", "object", "embed", "form", "input", "button", "textarea", "select", "link", "meta", "base", "template", "foreignObject"],
  FORBID_ATTR: ["srcdoc", "formaction", "action", "xlink:href"],
  ALLOW_DATA_ATTR: false,
};

let purifier: Purifier | null = null;
/** 测试里用 jsdom 的 window 替换 */
export function setSanitizeWindow(w: WindowLike) { purifier = DOMPurify(w); }

export function sanitizeHTML(html: string): string {
  if (!purifier) {
    if (typeof window === "undefined") throw new Error("sanitizeHTML 需要 DOM 环境");
    purifier = DOMPurify(window);
  }
  return purifier.sanitize(html, { ...CONFIG, RETURN_TRUSTED_TYPE: false }) as string;
}
