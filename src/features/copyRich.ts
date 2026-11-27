/**
 * N17 复制为带格式的文字（剪贴板部分）：选中的内容，没选中就是全文。
 * - 本地图片转成 data URL 内嵌，粘到别处也能显示；
 * - 公众号：公式画成 PNG 图片（MathML 放进 SVG 再画到画布上，用系统的数学字体，不依赖网页字体）；
 * - 剪贴板里同时放 HTML 和纯文本。
 * ClipboardItem 里放的是 Promise：写剪贴板的调用在用户操作的同一时刻发出，内容稍后准备好（Safari / WebKit 要求这样）。
 */
import katex from "katex";
import { markdownToRichHtml, RichTarget } from "../lib/richCopy";

interface Ctx { citeLabel: (k: string) => string; resolveImage: (src: string) => string; bodyFont?: string }

const toDataUrl = (b: Blob) => new Promise<string>((res, rej) => { const r = new FileReader(); r.onload = () => res(String(r.result)); r.onerror = rej; r.readAsDataURL(b); });

async function inlineImages(root: HTMLElement) {
  await Promise.all([...root.querySelectorAll<HTMLImageElement>("img[src]")].map(async (img) => {
    const src = img.getAttribute("src") || "";
    if (!src || src.startsWith("data:")) return;
    try { img.src = await toDataUrl(await (await fetch(src)).blob()); } catch { /* 取不到就留原地址 */ }
  }));
}

/** 公式画成图片：先在页面里量出 MathML 的大小，再放进 SVG 的 foreignObject 画到画布上 */
async function mathToPng(tex: string, display: boolean): Promise<{ url: string; w: number; h: number } | null> {
  const mathml = katex.renderToString(tex, { output: "mathml", displayMode: display, throwOnError: false });
  const probe = document.createElement("div");
  probe.style.cssText = "position:fixed;left:-9999px;top:0;font-size:17px;color:#333;white-space:nowrap;";
  probe.innerHTML = mathml;
  document.body.appendChild(probe);
  const box = (probe.querySelector("math") ?? probe).getBoundingClientRect();
  document.body.removeChild(probe);
  const w = Math.ceil(box.width) + 4, h = Math.ceil(box.height) + 4;
  if (w < 5 || h < 5) return null;
  const xhtml = new XMLSerializer().serializeToString(new DOMParser().parseFromString(`<div xmlns="http://www.w3.org/1999/xhtml" style="font-size:17px;color:#333;padding:2px;white-space:nowrap;">${mathml}</div>`, "text/html").body.firstChild!);
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}"><foreignObject width="100%" height="100%">${xhtml}</foreignObject></svg>`;
  const img = new Image();
  img.src = "data:image/svg+xml;charset=utf-8," + encodeURIComponent(svg);
  await img.decode();
  const k = 2;
  const c = document.createElement("canvas");
  c.width = w * k; c.height = h * k;
  const g = c.getContext("2d")!;
  g.scale(k, k);
  g.drawImage(img, 0, 0);
  return { url: c.toDataURL("image/png"), w, h };
}

async function wechatMath(root: HTMLElement) {
  for (const el of [...root.querySelectorAll<HTMLImageElement>("img[data-tex]")]) {
    const tex = el.dataset.tex || "", display = el.dataset.display === "1";
    try {
      const p = await mathToPng(tex, display);
      if (!p) throw new Error("空");
      el.src = p.url;
      el.setAttribute("style", `width:${p.w}px;height:${p.h}px;vertical-align:middle;${display ? "display:block;margin:0 auto;" : ""}`);
      el.removeAttribute("data-tex"); el.removeAttribute("data-display");
    } catch {
      el.replaceWith(document.createTextNode(display ? tex : `$${tex}$`));
    }
  }
}

export function buildRichHtml(md: string, target: RichTarget, ctx: Ctx): string {
  return markdownToRichHtml(md, {
    target, citeLabel: ctx.citeLabel, resolveImage: ctx.resolveImage, bodyFont: ctx.bodyFont,
    math: (tex, display) => { try { return katex.renderToString(tex, { output: "mathml", displayMode: display, throwOnError: false }); } catch { return tex; } },
  });
}

/** 准备好 HTML 和纯文本（图片内嵌、公众号的公式画成图片） */
export async function prepareRich(md: string, target: RichTarget, ctx: Ctx): Promise<{ html: string; text: string }> {
  const root = document.createElement("div");
  root.innerHTML = buildRichHtml(md, target, ctx);
  await inlineImages(root);
  if (target === "wechat") await wechatMath(root);
  const text = (root.textContent || "").replace(/\n{3,}/g, "\n\n").trim();
  return { html: root.innerHTML, text };
}

/** 写进剪贴板；成功返回 true */
export async function copyRich(md: string, target: RichTarget, ctx: Ctx): Promise<boolean> {
  const ready = prepareRich(md, target, ctx);
  try {
    if (typeof ClipboardItem === "undefined" || !navigator.clipboard?.write) throw new Error("no ClipboardItem");
    const item = new ClipboardItem({
      "text/html": ready.then((r) => new Blob([r.html], { type: "text/html" })),
      "text/plain": ready.then((r) => new Blob([r.text], { type: "text/plain" })),
    });
    await navigator.clipboard.write([item]);
    return true;
  } catch {
    // 退回老办法：在 copy 事件里塞进去
    const r = await ready;
    const f = (e: ClipboardEvent) => { e.preventDefault(); e.clipboardData?.setData("text/html", r.html); e.clipboardData?.setData("text/plain", r.text); };
    document.addEventListener("copy", f, { once: true });
    const ok = document.execCommand("copy");
    document.removeEventListener("copy", f);
    return ok;
  }
}
