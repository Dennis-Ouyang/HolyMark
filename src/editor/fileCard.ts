/**
 * 正文里单独成段的文件链接（PDF、Word、PPT、Excel、Markdown）显示成一条横向的行（E 节）：
 * 左边是文件类型的图标容器，右边两层字：标题（长名字中间截断）和一条最有用的信息（「20 页」「3 张表」）。
 * 操作悬停才出现，放在行的右端：打开、在访达中显示、更多（预览、源代码）。修改日期悬停时在右侧淡淡显示。
 * 纸张预览（一叠纸，最前面那张画出文件开头，PDF 是第一页缩略图）放进悬停图标时出现的浮层里，不常驻。
 * 双击用默认程序打开（Markdown 在 HolyMark 里打开）。找不到文件时同样是一条，下面用红字写「找不到这个文件」。
 */
import { EditorView, WidgetType } from "@codemirror/view";
import { cachedPreview, FilePreview, pdfThumb } from "../lib/filePreview";
import { iconSvg } from "../lib/icons";
import { isWindows } from "../lib/platform";
import { fileBadgeHTML, midNameEl } from "../lib/fileKind";
import { openDomMenu } from "./domMenu";

export interface FileHooks {
  /** 链接里的路径 → 绝对路径 */
  resolve: (src: string) => string;
  /** 绝对路径 → 能直接 fetch 的地址（读 PDF 用） */
  url: (abs: string) => string;
  preview: (abs: string) => Promise<FilePreview>;
  open: (abs: string) => void;
  reveal: (abs: string) => void;
  /** 找不到文件时「重新选择…」：让用户选一个文件，返回要写进链接的地址（相对路径），取消时 null */
  repick?: () => Promise<string | null>;
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
  let n = 0;
  for (const l of lines) {
    if (l.t === title) continue;
    sheet.append(el(l.h ? "div" : "p", l.h ? "fc-h" : n === 0 ? "fc-p lead" : "fc-p", l.t));
    if (!l.h) n++;
    if (sheet.childElementCount > 7) break;
  }
}

/** 纸张预览浮层：悬停图标 400ms 后出现，离开就收起 */
let peekEl: HTMLElement | null = null;
function showPeek(anchor: HTMLElement, fill: (sheet: HTMLElement, stage: HTMLElement) => void, kind: string) {
  hidePeek();
  const box = el("div", `hm-fpeek k-${kind}`);
  const stage = el("div", "fc-stage");
  const sheet = el("div", `fc-sheet front${kind === "ppt" ? " wide" : ""}`);
  stage.append(el("div", "fc-sheet back2"), el("div", "fc-sheet back1"), sheet);
  box.append(stage);
  fill(sheet, stage);
  document.body.append(box);
  const r = anchor.getBoundingClientRect(), b = box.getBoundingClientRect();
  const below = r.bottom + 8 + b.height < innerHeight - 8;
  box.style.left = Math.round(Math.max(8, Math.min(r.left, innerWidth - b.width - 8))) + "px";
  box.style.top = Math.round(below ? r.bottom + 8 : r.top - 8 - b.height) + "px";
  box.style.transformOrigin = below ? "15px 0" : `15px ${Math.round(b.height)}px`;
  peekEl = box;
}
function hidePeek() {
  if (!peekEl) return;
  const b = peekEl; peekEl = null;
  b.classList.add("leaving");
  setTimeout(() => b.remove(), 100);
}

export class FileCardWidget extends WidgetType {
  constructor(readonly src: string, readonly label: string, readonly hooks: FileHooks, readonly inline = false) { super(); }
  eq(o: FileCardWidget) { return o.src === this.src && o.label === this.label && o.inline === this.inline; }
  ignoreEvent() { return true; }

  toDOM(view: EditorView) {
    const abs = this.hooks.resolve(this.src);
    const name = abs.split("/").pop() || this.src;
    const kind = kindOf(name);
    const bar = el("div", `hm-fbar k-${kind}${this.inline ? " inl" : ""}`);
    bar.setAttribute("role", "group");
    bar.setAttribute("aria-label", `${KIND_NAME[kind]}：${name}`);
    const badge = el("span", "fb-ic");
    badge.innerHTML = fileBadgeHTML(name);
    const text = el("div", "fb-tx");
    // 类型由图标表达，标题不带扩展名（链接文字就是标题；没写链接文字时用文件名）
    const ext = name.match(/\.[^.]+$/)?.[0] ?? "";
    const shown = (this.label && ext && this.label.toLowerCase().endsWith(ext.toLowerCase()) ? this.label.slice(0, -ext.length) : this.label) || name.slice(0, name.length - ext.length);
    const title = el("div", "fb-t");
    title.append(midNameEl(shown, 8));
    const sub = el("div", "fb-s");
    text.append(title, sub);
    const date = el("span", "fb-d");
    const acts = el("div", "fb-a");
    const btn = (icon: string, label: string, run: (b: HTMLButtonElement) => void) => {
      const b = el("button", "fb-btn") as HTMLButtonElement;
      b.type = "button"; b.title = label; b.setAttribute("aria-label", label);
      b.innerHTML = iconSvg(icon, 15);
      b.addEventListener("mousedown", (e) => { e.preventDefault(); e.stopPropagation(); });
      b.addEventListener("click", (e) => { e.stopPropagation(); run(b); });
      return b;
    };
    const toSource = () => {
      const pos = view.posAtDOM(bar);
      view.dispatch({ selection: { anchor: Math.min(pos + 1, view.state.doc.length) } });
      view.focus();
    };
    let preview: FilePreview | null = null;
    let thumb: { url: string; pages: number } | null = null;
    const fillPeek = (sheet: HTMLElement) => {
      if (thumb) { const img = el("img") as HTMLImageElement; img.src = thumb.url; img.alt = ""; img.draggable = false; sheet.classList.add("img"); sheet.replaceChildren(img); }
      else if (preview) drawSheet(sheet, preview, this.label || name.replace(/\.[^.]+$/, ""));
      else sheet.append(el("div", "fc-skel"), el("div", "fc-skel short"));
    };
    const reveal = btn("folder", isWindows ? "在资源管理器中显示" : "在访达中显示", () => this.hooks.reveal(abs));
    const more = btn("dots", "更多", (b) => {
      b.classList.add("open");
      openDomMenu(b, [
        ...(preview ? [{ label: "预览", icon: "eye", run: () => showPeek(badge, fillPeek, kind) }] : []),
        { label: "显示源代码", icon: "source", run: toSource },
      ], { label: "文件", onClose: () => b.classList.remove("open") });
    });
    acts.append(btn("external", kind === "md" ? "在 HolyMark 里打开" : "用默认程序打开", () => this.hooks.open(abs)), reveal, more);
    bar.append(badge, text, date, acts);

    // 悬停图标一会儿：纸张预览
    let t = 0;
    badge.addEventListener("mouseenter", () => { if (preview) t = window.setTimeout(() => showPeek(badge, fillPeek, kind), 400); });
    badge.addEventListener("mouseleave", () => { clearTimeout(t); hidePeek(); });
    bar.addEventListener("mousedown", (e) => { if (!(e.target as HTMLElement).closest(".fb-btn")) e.preventDefault(); });
    bar.addEventListener("dblclick", (e) => { if ((e.target as HTMLElement).closest(".fb-btn")) return; hidePeek(); this.hooks.open(abs); });

    // 异步填内容：只放一条最有用的信息，类型由图标表达
    cachedPreview(abs, this.hooks.preview).then(async (p) => {
      if (!p) {
        bar.classList.add("missing");
        badge.innerHTML = fileBadgeHTML(name, "lg", true);
        sub.textContent = "找不到这个文件";
        acts.replaceChildren();
        if (this.hooks.repick) acts.append(btnText("重新选择…", async () => {
          const href = await this.hooks.repick!();
          if (!href) return;
          const at = view.posAtDOM(bar), line = view.state.doc.lineAt(at);
          const fixed = line.text.replace(/\]\((<[^>]+>|[^)\s]+)\)/, `](${/[\s()<>]/.test(href) ? `<${href}>` : href})`);
          if (fixed !== line.text) view.dispatch({ changes: { from: line.from, to: line.to, insert: fixed } });
        }));
        acts.append(more);
        return;
      }
      preview = p;
      if (p.modified) date.textContent = fmtDay(p.modified);
      let info = "";
      if (p.kind === "pdf") {
        thumb = await pdfThumb(this.hooks.url(abs));
        if (thumb) info = `${thumb.pages} 页`;
      } else if (p.pages) info = p.kind === "ppt" ? `${p.pages} 张幻灯片` : p.kind === "excel" ? `${p.pages} 张表` : `${p.pages} 页`;
      if (!info) info = (p.kind === "md" ? p.lines.map(plain).find((l) => l && l !== plain(p.lines[0] || "")) : p.lines.find(Boolean)) || "";
      sub.textContent = info;
      if (!info) bar.classList.add("one");
    });
    return bar;
  }
}

function btnText(text: string, run: () => void) {
  const b = el("button", "fb-txtbtn") as HTMLButtonElement;
  b.type = "button";
  b.textContent = text;
  b.addEventListener("mousedown", (e) => { e.preventDefault(); e.stopPropagation(); });
  b.addEventListener("click", (e) => { e.stopPropagation(); run(); });
  return b;
}
