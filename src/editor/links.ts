/**
 * 正文里的链接：打开链接的唯一入口（B10 + N2 + N4）。
 * - 编辑时 ⌘ / Ctrl + 点击打开，悬停显示地址；阅读模式里直接单击（readingMode.ts 也调这里的 openLink）。
 * - 网页交给系统浏览器；本机 .md 在 HolyMark 里打开（可带 #锚点，跨文件跳转）；其他文件用默认程序打开；
 *   #锚点按 Pandoc 的 auto_identifiers 规则找标题（lib/anchors.ts），找不到由 App 用提示条说明，跳转记进返回 / 前进的历史。
 */
import { syntaxTree } from "@codemirror/language";
import type { EditorState, Extension } from "@codemirror/state";
import { EditorView, hoverTooltip } from "@codemirror/view";
import type { SyntaxNode } from "@lezer/common";
import { dirOf, join, normalize, toPosix } from "../lib/paths";
import { isMac } from "../lib/platform";
import { findAnchor } from "../lib/anchors";
import { isReading } from "./readingMode";

export type LinkTarget =
  | { kind: "web"; url: string }
  | { kind: "anchor"; id: string }
  /** anchor：另一篇 Markdown 里的标题（a.md#第三章），没有时不出现 */
  | { kind: "file"; abs: string; md: boolean; anchor?: string };

const SCHEME = /^[a-z][a-z0-9+.-]*:/i;

/** 链接地址是不是本机文件（不带 http: 之类的协议、也不是 #锚点） */
export function isLocalHref(href: string) {
  const h = href.trim().replace(/^<(.*)>$/, "$1");
  return !!h && !h.startsWith("#") && (!SCHEME.test(h) || /^[A-Za-z]:[\\/]/.test(h) || /^file:/i.test(h));
}

/** 链接地址 → 要打开的东西。相对路径按文稿所在的文件夹解析 */
export function classifyLink(href: string, docPath: string): LinkTarget | null {
  let h = href.trim().replace(/^<(.*)>$/, "$1");
  if (!h) return null;
  if (h.startsWith("#")) return { kind: "anchor", id: decodeComp(h.slice(1)) };
  if (/^(https?|mailto):/i.test(h)) return { kind: "web", url: h };
  if (/^www\./i.test(h)) return { kind: "web", url: "https://" + h };
  if (/^file:\/\//i.test(h)) h = decodeSafe(h.replace(/^file:\/\/(localhost)?/i, "")).replace(/^\/([A-Za-z]:)/, "$1");
  else if (SCHEME.test(h) && !/^[A-Za-z]:[\\/]/.test(h)) return null; // 其他协议不打开
  const hash = h.indexOf("#");
  const anchor = hash >= 0 ? decodeComp(h.slice(hash + 1)) : "";
  h = decodeSafe(h.replace(/[?#].*$/, ""));
  const abs = /^(\/|[A-Za-z]:[\\/])/.test(h) ? toPosix(h) : normalize(join(dirOf(docPath), h));
  const md = /\.(md|markdown)$/i.test(abs);
  return md && anchor ? { kind: "file", abs, md, anchor } : { kind: "file", abs, md };
}

function decodeSafe(s: string) { try { return decodeURI(s); } catch { return s; } }
function decodeComp(s: string) { try { return decodeURIComponent(s); } catch { return s; } }

export interface LinkHooks {
  /** 当前文稿的路径（解析相对路径用） */
  docPath: () => string;
  /** 网页链接：交给系统浏览器 */
  openUrl: (url: string) => void;
  /** 本机文件：.md 在 HolyMark 里打开（anchor 是要跳到的标题），其他用默认程序 */
  openFile: (abs: string, md: boolean, anchor?: string) => void;
  /** 文内锚点 #标题（找不到时由调用方提示）；没给时直接按标题跳 */
  jump?: (id: string) => boolean;
}

/** 打开一个链接。返回是否认得这个链接 */
export function openLink(href: string, hooks: LinkHooks): boolean {
  const t = classifyLink(href, hooks.docPath());
  if (!t) return false;
  if (t.kind === "web") hooks.openUrl(t.url);
  else if (t.kind === "file") hooks.openFile(t.abs, t.md, t.anchor);
  else return hooks.jump ? hooks.jump(t.id) : false;
  return true;
}

/** pos 处的链接地址：[文字](地址)、<地址>、裸网址（图片、文献引用不算）。两侧都看一下，点在链接末尾也认 */
export function linkAt(state: EditorState, pos: number): { from: number; to: number; href: string } | null {
  for (const side of [1, -1] as const) {
    for (let n: SyntaxNode | null = syntaxTree(state).resolveInner(pos, side); n; n = n.parent) {
      if (n.name === "Image") return null;
      if (n.name === "Link" || n.name === "Autolink") {
        if (/^\[@/.test(state.sliceDoc(n.from, n.from + 2))) return null; // 文献引用
        const u = n.getChild("URL");
        if (!u) return null;
        return { from: n.from, to: n.to, href: state.sliceDoc(u.from, u.to) };
      }
      if (n.name === "URL" && n.parent?.name !== "Link" && n.parent?.name !== "Image") return { from: n.from, to: n.to, href: state.sliceDoc(n.from, n.to) };
      if (n.name === "Paragraph" || n.name === "Document") break;
    }
  }
  return null;
}

/** 跳到标题：按 Pandoc 的锚点规则（和导出一致），也认标题原文、{#id} */
export function headingPos(state: EditorState, id: string): number | null {
  return findAnchor(state.doc.toString(), id)?.pos ?? null;
}

const modName = isMac ? "⌘" : "Ctrl";

export function links(hooks: LinkHooks): Extension {
  const withJump = (view: EditorView): LinkHooks => ({
    ...hooks,
    jump: (id) => {
      const p = headingPos(view.state, id);
      if (p === null) return false;
      view.dispatch({ selection: { anchor: p }, effects: EditorView.scrollIntoView(p, { y: "start", yMargin: 60 }) });
      return true;
    },
  });
  return [
    EditorView.domEventHandlers({
      mousedown(e, view) {
        // 阅读模式里单击就打开，由 readingMode.ts 处理；这里只管编辑时的 ⌘ / Ctrl + 点击
        if (e.button !== 0 || !(isMac ? e.metaKey && !e.ctrlKey : e.ctrlKey && !e.metaKey) || e.altKey || isReading(view.state)) return false;
        // 用链接元素自己的位置（折行的链接按坐标会落到别处）
        const el = (e.target as HTMLElement).closest(".hm-link, .cm-content a");
        let pos: number | null = null;
        if (el) try { pos = view.posAtDOM(el) + 1; } catch { /* 用坐标 */ }
        if (pos === null) pos = view.posAtCoords({ x: e.clientX, y: e.clientY });
        if (pos === null) return false;
        const l = linkAt(view.state, pos);
        if (!l) return false;
        e.preventDefault();
        openLink(l.href, withJump(view));
        return true;
      },
    }),
    // 悬停提示：只放文字（地址和怎么打开），不放可点的东西
    hoverTooltip((view, pos) => {
      const l = linkAt(view.state, pos);
      if (!l) return null;
      return {
        pos: l.from, end: l.to, above: true,
        create: () => {
          const dom = document.createElement("div");
          dom.className = "hm-linktip";
          const a = document.createElement("span");
          a.className = "addr";
          a.textContent = l.href.replace(/^<(.*)>$/, "$1");
          const k = document.createElement("span");
          k.className = "how";
          k.textContent = isReading(view.state) ? "点击打开" : `${modName} 点击打开`;
          dom.append(a, k);
          return { dom };
        },
      };
    }, { hoverTime: 400 }),
    EditorView.domEventHandlers({
      // 按住 ⌘ / Ctrl 时链接显示成可点的样子
      keydown(e, view) { if (e.key === (isMac ? "Meta" : "Control")) view.dom.classList.add("hm-modkey"); return false; },
      keyup(e, view) { if (e.key === (isMac ? "Meta" : "Control")) view.dom.classList.remove("hm-modkey"); return false; },
      blur(_e, view) { view.dom.classList.remove("hm-modkey"); return false; },
    }),
  ];
}
