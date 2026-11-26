/**
 * 正文里的链接：⌘ / Ctrl + 点击打开，悬停显示地址。
 * 「打开一个链接」写成独立的 openLink，以后阅读模式改成单击打开、文内跳转加返回，都从这里接。
 */
import { syntaxTree } from "@codemirror/language";
import type { EditorState, Extension } from "@codemirror/state";
import { EditorView, hoverTooltip } from "@codemirror/view";
import type { SyntaxNode } from "@lezer/common";
import { dirOf, join, normalize, toPosix } from "../lib/paths";
import { isMac } from "../lib/platform";

export type LinkTarget =
  | { kind: "web"; url: string }
  | { kind: "anchor"; id: string }
  | { kind: "file"; abs: string; md: boolean };

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
  if (h.startsWith("#")) return { kind: "anchor", id: decodeSafe(h.slice(1)) };
  if (/^(https?|mailto):/i.test(h)) return { kind: "web", url: h };
  if (/^file:\/\//i.test(h)) h = decodeSafe(h.replace(/^file:\/\/(localhost)?/i, "")).replace(/^\/([A-Za-z]:)/, "$1");
  else if (SCHEME.test(h) && !/^[A-Za-z]:[\\/]/.test(h)) return null; // 其他协议不打开
  h = decodeSafe(h.replace(/[?#].*$/, ""));
  const abs = /^(\/|[A-Za-z]:[\\/])/.test(h) ? toPosix(h) : normalize(join(dirOf(docPath), h));
  return { kind: "file", abs, md: /\.(md|markdown)$/i.test(abs) };
}

function decodeSafe(s: string) { try { return decodeURI(s); } catch { return s; } }

export interface LinkHooks {
  /** 当前文稿的路径（解析相对路径用） */
  docPath: () => string;
  /** 网页链接：交给系统浏览器 */
  openUrl: (url: string) => void;
  /** 本机文件：.md 在 HolyMark 里打开，其他用默认程序 */
  openFile: (abs: string, md: boolean) => void;
  /** 文内锚点 #标题 */
  jump?: (id: string) => boolean;
}

/** 打开一个链接。返回是否认得这个链接 */
export function openLink(href: string, hooks: LinkHooks): boolean {
  const t = classifyLink(href, hooks.docPath());
  if (!t) return false;
  if (t.kind === "web") hooks.openUrl(t.url);
  else if (t.kind === "file") hooks.openFile(t.abs, t.md);
  else return hooks.jump ? hooks.jump(t.id) : false;
  return true;
}

/** pos 处的链接地址：[文字](地址)、<地址>、裸网址 */
export function linkAt(state: EditorState, pos: number): { from: number; to: number; href: string } | null {
  for (let n: SyntaxNode | null = syntaxTree(state).resolveInner(pos, 1); n; n = n.parent) {
    if (n.name === "Link" || n.name === "Autolink") {
      const t = state.sliceDoc(n.from, n.to);
      if (/^\[@[\w:-]+\]$/.test(t)) return null; // 文献引用
      const u = n.getChild("URL");
      if (!u) return null;
      return { from: n.from, to: n.to, href: state.sliceDoc(u.from, u.to) };
    }
    if (n.name === "URL" && n.parent?.name !== "Link" && n.parent?.name !== "Image") return { from: n.from, to: n.to, href: state.sliceDoc(n.from, n.to) };
    if (n.name === "Paragraph" || n.name === "Document") break;
  }
  return null;
}

/** 跳到标题：#锚点 和标题文字比较（忽略大小写、空格和连字符） */
export function headingPos(state: EditorState, id: string): number | null {
  const norm = (s: string) => s.toLowerCase().replace(/[\s\-_]+/g, "");
  const want = norm(id);
  for (let i = 1; i <= state.doc.lines; i++) {
    const m = state.doc.line(i).text.match(/^#{1,6}\s+(.*?)\s*(\{#([^}]+)\})?\s*$/);
    if (m && (norm(m[1]) === want || (m[3] && m[3] === id))) return state.doc.line(i).from;
  }
  return null;
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
        if (e.button !== 0 || !(isMac ? e.metaKey : e.ctrlKey)) return false;
        const pos = view.posAtCoords({ x: e.clientX, y: e.clientY });
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
          k.textContent = `${modName} 点击打开`;
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
