/**
 * 正文里单独成段的文件链接（PDF、Word、PPT、Excel、Markdown）显示成纸张卡片：
 * 上面是一叠纸，最前面那张画出文件开头的样子（PDF 是第一页的缩略图）；下面一条写文件名、类型、日期。
 * 鼠标移上去，前面那张纸上浮一点、后面的纸往两边展开。
 * 点一下出工具条（打开、在访达中显示、源代码），双击直接用默认程序打开（Markdown 在 HolyMark 里打开）。
 */
import { EditorView, WidgetType } from "@codemirror/view";
import { cachedPreview, FilePreview, pdfThumb } from "../lib/filePreview";
import { iconSvg } from "../lib/icons";
import { isWindows } from "../lib/platform";

export interface FileHooks {
  /** 链接里的路径 → 绝对路径 */
  resolve: (src: string) => string;
  /** 绝对路径 → 能直接 fetch 的地址（读 PDF 用） */
  url: (abs: string) => string;
  preview: (abs: string) => Promise<FilePreview>;
  open: (abs: string) => void;
  reveal: (abs: string) => void;
}

const KIND_NAME: Record<FilePreview["kind"], string> = { md: "Markdown", word: "Word", ppt: "PPT", excel: "Excel", pdf: "PDF", other: "文件" };
const kindOf = (name: string): FilePreview["kind"] => {
  const e = name.split(".").pop()!.toLowerCase();
  return e === "pdf" ? "pdf" : /^(docx?|dotx|rtf)$/.test(e) ? "word" : /^(pptx?|key)$/.test(e) ? "ppt" : /^(xlsx?|csv|numbers)$/.test(e) ? "excel" : /^(md|markdown)$/.test(e) ? "md" : "other";
};
const el = (tag: string, cls?: string, text?: string) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text !== undefined) e.textContent = text; return e; };
const fmtDay = (ms: number) => { if (!ms) return ""; const d = new Date(ms); return d.getFullYear() === new Date().getFullYear() ? `${d.getMonth() + 1}月${d.getDate()}日` : `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日`; };
/** Markdown 一段里的符号去掉，只留字 */
const plain = (s: string) => s.replace(/^#{1,6}\s+/, "").replace(/!\[[^\]]*\]\([^)]*\)/g, "").replace(/\[([^\]]*)\]\([^)]*\)/g, "$1").replace(/[*_~`=>]|^\s*[-+]\s+|^\s*\d+\.\s+/gm, "").replace(/\{==|==\}|\{>>[\s\S]*?<<\}/g, "").trim();

/** 最前面那张纸上画的内容 */
function drawSheet(sheet: HTMLElement, p: FilePreview, label: string) {
  sheet.replaceChildren();
  if (p.kind === "excel" && p.lines.length) {
    const t = el("table", "fc-grid");
    p.lines.slice(0, 7).forEach((row, i) => {
      const tr = el("tr");
      row.split("\t").slice(0, 5).forEach((c) => tr.appendChild(el(i === 0 ? "th" : "td", undefined, c)));
      t.appendChild(tr);
    });
    sheet.append(el("div", "fc-title small", p.title || label), t);
    return;
  }
  if (p.kind === "ppt") {
    const lines = p.lines.filter(Boolean);
    sheet.append(el("div", "fc-slide-t", lines[0] || p.title || label));
    if (lines[1]) sheet.append(el("div", "fc-slide-s", lines.slice(1, 3).join("　")));
    return;
  }
  const lines = p.kind === "md" ? p.lines.map((l) => ({ h: /^#{1,6}\s/.test(l), t: plain(l) })).filter((l) => l.t) : p.lines.map((t) => ({ h: t.length <= 16, t }));
  const title = p.kind === "md" ? (lines.find((l) => l.h)?.t ?? label) : p.title || label;
  sheet.append(el("div", "fc-title", title));
  if (p.modified) sheet.append(el("span", "fc-chip", fmtDay(p.modified)));
  let n = 0;
  for (const l of lines) {
    if (l.t === title) continue;
    sheet.append(el(l.h ? "div" : "p", l.h ? "fc-h" : n === 0 ? "fc-p lead" : "fc-p", l.t));
    if (!l.h) n++;
    if (sheet.childElementCount > 7) break;
  }
}

export class FileCardWidget extends WidgetType {
  constructor(readonly src: string, readonly label: string, readonly hooks: FileHooks) { super(); }
  eq(o: FileCardWidget) { return o.src === this.src && o.label === this.label; }
  ignoreEvent() { return true; }

  toDOM(view: EditorView) {
    const abs = this.hooks.resolve(this.src);
    const name = abs.split("/").pop() || this.src;
    const kind = kindOf(name);
    const card = el("div", `hm-fcard k-${kind}`);
    card.setAttribute("role", "group");
    card.setAttribute("aria-label", `${KIND_NAME[kind]}：${name}`);
    card.title = `${name}\n双击打开`;
    const stage = el("div", "fc-stage");
    const sheet = el("div", `fc-sheet front${kind === "ppt" ? " wide" : ""}`);
    stage.append(el("div", "fc-sheet back2"), el("div", "fc-sheet back1"), sheet);
    sheet.append(el("div", "fc-title", this.label || name.replace(/\.[^.]+$/, "")), el("div", "fc-skel"), el("div", "fc-skel short"));
    const meta = el("div", "fc-meta");
    const nm = el("b", undefined, this.label || name.replace(/\.[^.]+$/, ""));
    const sub = el("small", undefined, KIND_NAME[kind]);
    meta.append(nm, sub);
    card.append(stage, meta);

    // 工具条：和图片的一样，点一下出来
    const bar = el("div", "hm-itools");
    bar.setAttribute("role", "toolbar");
    const btn = (text: string, title: string, run: () => void, icon?: string) => {
      const b = el("button") as HTMLButtonElement;
      b.type = "button"; b.title = title;
      b.innerHTML = (icon ? iconSvg(icon, 14) : "") + `<span>${text}</span>`;
      b.addEventListener("mousedown", (e) => { e.preventDefault(); e.stopPropagation(); });
      b.addEventListener("click", (e) => { e.stopPropagation(); run(); });
      return b;
    };
    bar.append(
      btn("打开", kind === "md" ? "在 HolyMark 里打开" : "用默认程序打开", () => { close(); this.hooks.open(abs); }, "open"),
      btn(isWindows ? "在资源管理器中显示" : "在访达中显示", "", () => { close(); this.hooks.reveal(abs); }, "folder"),
      el("span", "sep"),
      btn("源代码", "显示这个链接的 Markdown 源码", () => {
        close();
        const pos = view.posAtDOM(card);
        view.dispatch({ selection: { anchor: Math.min(pos + 1, view.state.doc.length) } });
        view.focus();
      }),
    );
    card.appendChild(bar);
    const outside = (e: MouseEvent) => { if (!card.contains(e.target as Node)) close(); };
    const open = () => { card.classList.add("editing"); addEventListener("mousedown", outside, true); };
    const close = () => { card.classList.remove("editing"); removeEventListener("mousedown", outside, true); };
    card.addEventListener("mousedown", (e) => { if ((e.target as HTMLElement).closest(".hm-itools")) return; e.preventDefault(); if (!card.classList.contains("editing")) open(); });
    card.addEventListener("dblclick", (e) => { if ((e.target as HTMLElement).closest(".hm-itools")) return; close(); this.hooks.open(abs); });

    // 异步填内容
    cachedPreview(abs, this.hooks.preview).then(async (p) => {
      if (!p) { card.classList.add("missing"); sub.textContent = `找不到这个文件 · ${KIND_NAME[kind]}`; sheet.replaceChildren(el("div", "fc-missing", "找不到文件")); return; }
      const bits = [KIND_NAME[p.kind === "other" ? kind : p.kind], fmtDay(p.modified)];
      if (p.kind === "pdf") {
        const th = await pdfThumb(this.hooks.url(abs));
        if (th) {
          const img = el("img") as HTMLImageElement;
          img.src = th.url; img.alt = ""; img.draggable = false;
          sheet.classList.add("img");
          sheet.replaceChildren(img);
          bits.push(`${th.pages} 页`);
        } else drawSheet(sheet, { ...p, lines: [] }, this.label || name);
      } else {
        drawSheet(sheet, p, this.label || name.replace(/\.[^.]+$/, ""));
        if (p.pages) bits.push(p.kind === "ppt" ? `${p.pages} 张幻灯片` : p.kind === "excel" ? `${p.pages} 张表` : `${p.pages} 页`);
      }
      sub.textContent = bits.filter(Boolean).join(" · ");
    });
    return card;
  }
}
