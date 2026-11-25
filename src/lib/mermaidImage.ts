/** 导出用的 Mermaid 图：浅色、纯 SVG 文字（不用 foreignObject，否则转成图片后文字会丢）。 */
let seq = 0;

export async function renderMermaid(code: string): Promise<string> {
  const { default: mermaid } = await import("mermaid");
  mermaid.initialize({ startOnLoad: false, theme: "neutral", securityLevel: "strict", htmlLabels: false, flowchart: { htmlLabels: false } });
  const { svg } = await mermaid.render("hm-export-mm-" + ++seq, code);
  return fixedSize(svg);
}

/** Mermaid 输出的 SVG 宽度是 100%，换成 viewBox 的实际尺寸，图片才有固定大小 */
export function fixedSize(svg: string): string {
  const vb = svg.match(/viewBox="([\d.\s-]+)"/);
  if (!vb) return svg;
  const [, , w, h] = vb[1].trim().split(/\s+/).map(Number);
  return svg.replace(/<svg([^>]*)>/, (_m, attrs: string) => {
    const a = attrs.replace(/\swidth="[^"]*"/, "").replace(/\sheight="[^"]*"/, "").replace(/\sstyle="[^"]*"/, "");
    return `<svg${a} width="${w}" height="${h}">`;
  });
}

/** SVG → PNG（base64，不带 data: 前缀） */
export function svgToPng(svg: string, scale = 2): Promise<string> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const c = document.createElement("canvas");
      c.width = Math.max(1, Math.round(img.naturalWidth * scale));
      c.height = Math.max(1, Math.round(img.naturalHeight * scale));
      const g = c.getContext("2d")!;
      g.fillStyle = "#fff";
      g.fillRect(0, 0, c.width, c.height);
      g.drawImage(img, 0, 0, c.width, c.height);
      resolve(c.toDataURL("image/png").split(",")[1]);
    };
    img.onerror = () => reject(new Error("图表转换成图片失败"));
    img.src = "data:image/svg+xml;charset=utf-8," + encodeURIComponent(svg);
  });
}
