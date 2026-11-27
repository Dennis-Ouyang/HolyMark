/**
 * 文件预览卡片的数据：标题、开头几段、页数（Rust 从 Word / PPT / Excel / Markdown 里读），
 * PDF 第一页的缩略图（pdf.js，用到时才加载）。结果按路径缓存，同一个文件不重复读。
 */
export interface FilePreview {
  kind: "md" | "word" | "ppt" | "excel" | "pdf" | "other";
  title: string;
  lines: string[];
  size: number;
  modified: number;
  pages?: number | null;
}

/** 整篇的阅读版（正文区的只读预览）：PPT 每张一节，Excel 每张工作表一节，Word 一节是全部段落 */
export interface FileDocument extends FilePreview { sections: { title: string; lines: string[] }[] }

/** 正文区能预览的类型 */
export const IMAGE_EXT = /\.(png|jpe?g|gif|webp|svg|bmp)$/i;
export function previewKind(path: string): "pdf" | "image" | "office" | "other" {
  if (/\.pdf$/i.test(path)) return "pdf";
  if (IMAGE_EXT.test(path)) return "image";
  if (/\.(docx|dotx|pptx|xlsx)$/i.test(path)) return "office";
  return "other";
}

/** 正文里单独成段时显示成卡片的文件类型 */
export const CARD_EXT = /\.(pdf|docx?|dotx|pptx?|key|xlsx?|csv|numbers|md|markdown)$/i;

const cache = new Map<string, Promise<FilePreview | null>>();
export function cachedPreview(abs: string, load: (p: string) => Promise<FilePreview>): Promise<FilePreview | null> {
  let p = cache.get(abs);
  if (!p) {
    p = load(abs).catch(() => null);
    cache.set(abs, p);
    // 文件可能被改过：过一会儿允许重新读
    window.setTimeout(() => cache.delete(abs), 60_000);
  }
  return p;
}

const thumbs = new Map<string, Promise<{ url: string; pages: number } | null>>();
/** PDF 第一页画成图片（宽 480 像素，够卡片用） */
export function pdfThumb(url: string): Promise<{ url: string; pages: number } | null> {
  let p = thumbs.get(url);
  if (!p) {
    p = (async () => {
      const pdfjs: any = await import("pdfjs-dist/legacy/build/pdf");
      const worker = (await import("pdfjs-dist/legacy/build/pdf.worker.min.js?url")).default;
      pdfjs.GlobalWorkerOptions.workerSrc = worker;
      const data = new Uint8Array(await (await fetch(url)).arrayBuffer());
      const doc = await pdfjs.getDocument({ data, isEvalSupported: false }).promise;
      const page = await doc.getPage(1);
      const v0 = page.getViewport({ scale: 1 });
      const vp = page.getViewport({ scale: 480 / v0.width });
      const canvas = document.createElement("canvas");
      canvas.width = Math.round(vp.width);
      canvas.height = Math.round(vp.height);
      await page.render({ canvasContext: canvas.getContext("2d")!, viewport: vp }).promise;
      const out = { url: canvas.toDataURL("image/jpeg", 0.82), pages: doc.numPages as number };
      doc.destroy();
      return out;
    })().catch(() => null);
    thumbs.set(url, p);
  }
  return p;
}
