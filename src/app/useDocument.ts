/**
 * 当前文档的读写、自动保存、外部修改三方合并、关闭窗口与编辑器常用操作 hook。
 */
import { useCallback, useEffect, useRef, useState } from "react";
import type { EditorView } from "@codemirror/view";
import type { EditorHandle } from "../editor/Editor";
import { Backend, isTauri, VersionMeta } from "../lib/backend";
import { changedLines, Note, setDocLayout } from "../lib/markdown";
import { fontStack, Settings } from "../lib/settings";
import { BibEntry, citeOne } from "../lib/bib";
import { blockInsertSpec } from "../editor/commands";
import { linkFor } from "../components/InsertFile";
import { dirOf, join } from "../lib/paths";
import { merge3 } from "../lib/merge";
import { copyRich } from "../features/copyRich";
import type { DlgKind, LiveDoc, SayFn } from "./appUtils";

export interface UseDocumentArgs {
  be: Backend | null;
  s: Settings;
  path: string;
  setPath: (p: string) => void;
  setText: (t: string) => void;
  setViewing: (p: string) => void;
  setScrollHeading: (i: number) => void;
  setDlg: React.Dispatch<React.SetStateAction<DlgKind>>;
  live: React.MutableRefObject<LiveDoc>;
  ed: React.RefObject<EditorHandle>;
  scroller: React.RefObject<HTMLDivElement>;
  view: () => EditorView | null;
  layout: Record<string, string>;
  bibMap: Map<string, BibEntry>;
  resolveImage: (src: string) => string;
  readingOn: boolean;
  cmpActive: boolean;
  setVersions: (vs: VersionMeta[]) => void;
  setFresh: (id: string | null) => void;
  clearCompare: () => void;
  commitCheckpoint: () => Promise<void>;
  commitAllStaged: () => Promise<void>;
  onOpenSpot: (p: string, opts?: { reading?: boolean; target?: boolean; readingDefault?: boolean }) => void;
  onCaptureSpot: (p: string) => void;
  onStatsOpen: (p: string, content: string) => void;
  onStatsSave: (p: string, content: string) => void;
  say: SayFn;
}

export function useDocument(a: UseDocumentArgs) {
  const { be, s, path, setPath, setText, setViewing, setScrollHeading, setDlg, live, ed, scroller, view, layout, bibMap, resolveImage, readingOn, cmpActive, setVersions, setFresh, clearCompare, commitCheckpoint, commitAllStaged, onOpenSpot, onCaptureSpot, onStatsOpen, onStatsSave, say } = a;
  const [saveState, setSaveState] = useState<"saved" | "saving" | "error">("saved");
  const saveTimer = useRef<number>();

  async function flush() {
    window.clearTimeout(saveTimer.current);
    const l = live.current;
    if (be && l.path && l.text !== l.lastWritten) {
      // 第一次真正改动：先把打开时的内容存成起点版本，再写入改动
      if (l.needBase) {
        l.needBase = false;
        const v = await be.saveVersion(l.path, l.base, "auto").catch(() => null);
        if (v) { const at = l.path; be.listVersions(at).then((vs) => { if (live.current.path === at) setVersions(vs); }).catch(() => {}); }
      }
      await be.writeText(l.path, l.text);
      l.lastWritten = l.text;
      setSaveState("saved");
      onStatsSave(l.path, l.text);
    }
  }

  /** target：从搜索结果、文内链接这类有明确目标的方式打开，不恢复上次的位置 */
  async function openFile(p: string, opts?: { reading?: boolean; target?: boolean; readingDefault?: boolean }) {
    if (!be) return;
    setViewing("");
    if (live.current.path) onCaptureSpot(live.current.path);
    await flush();
    const content = await be.readText(p);
    await commitCheckpoint().catch(() => {});
    live.current = { path: p, text: content, base: content, opened: content, lastWritten: content, lastVersionAt: Date.now(), needBase: true };
    setPath(p); setText(content); clearCompare(); setFresh(null);
    ed.current?.load(content);
    onStatsOpen(p, content);
    if (scroller.current) scroller.current.scrollTop = 0;
    setScrollHeading(0);
    onOpenSpot(p, opts);
    // 起点版本不在打开时存（不写盘），见 flush()；这里只读已有的版本
    setVersions(await be.listVersions(p).catch(() => []));
  }

  /* ---------- editing, autosave, auto versions ---------- */
  // 字数、大纲、批注这些全文统计不必每个按键都算：最多每 250ms 跟一次正文，长稿打字不卡
  const textTimer = useRef(0);
  const onChange = useCallback((t: string) => {
    live.current.text = t;
    if (!textTimer.current) textTimer.current = window.setTimeout(() => { textTimer.current = 0; setText(live.current.text); }, 250);
    setSaveState("saving");
    window.clearTimeout(saveTimer.current);
    saveTimer.current = window.setTimeout(() => { flush().catch(() => setSaveState("error")); }, 600);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [be]);

  useEffect(() => {
    if (!be) return;
    const id = window.setInterval(async () => {
      const l = live.current;
      if (!l.path || l.needBase || Date.now() - l.lastVersionAt < s.autoMinutes * 60_000) return; // 打开后没改过就不存（不建版本库）
      await flush();
      const v = await be.saveVersion(l.path, l.text, "auto").catch(() => null);
      l.lastVersionAt = Date.now();
      if (v) setVersions(await be.listVersions(l.path));
    }, 30_000);
    return () => window.clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [be, s.autoMinutes]);

  // 文件被外部程序改写：替换内容、刷新版本列表，「版本」上亮一个小圆点，不弹任何提示
  useEffect(() => {
    if (!be) return;
    return be.onExternalChange(async (p) => {
      if (p !== live.current.path) return;
      const content = await be.readText(p);
      const l = live.current;
      if (content === l.text) return;
      const before = l.text;
      // 编辑器里还有没写盘的字（自动保存的 600ms 防抖窗口里）：先存成版本，保证不会丢；
      // 再按块三方合并（基线是上次写盘的内容）。改的是不同块就直接合并，同一处两边都保留
      const unsaved = l.text !== l.lastWritten;
      if (unsaved) await be.saveVersion(p, l.text, "auto").catch(() => null);
      const { text: merged, conflicts } = unsaved ? merge3(l.lastWritten, l.text, content) : { text: content, conflicts: 0 };
      l.text = merged; l.lastWritten = content; l.base = content;
      ed.current?.replace(merged);
      ed.current?.flash(changedLines(before, merged));
      setText(merged);
      if (merged !== content) {
        await flush().catch(() => setSaveState("error"));
        if (conflicts) say("外部程序也改了你正在写的地方，两边的内容都保留了，请看一下", "warn");
        else say("已合并外部修改和你刚编辑的内容", "success");
      }
      const vs = await be.listVersions(p);
      setVersions(vs);
      setFresh(vs[0]?.id ?? null);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [be]);

  useEffect(() => {
    const f = () => { flush(); commitCheckpoint(); };
    addEventListener("beforeunload", f);
    return () => removeEventListener("beforeunload", f);
  });

  /* ---------- 关闭应用：一直在自动保存，直接关（G1） ---------- */
  const closing = useRef(false);
  async function reallyClose() {
    closing.current = true;
    await commitAllStaged();
    setDlg(null);
    if (!isTauri) { closing.current = false; say("浏览器预览里不会真的关闭窗口"); return; }
    const { getCurrentWindow } = await import("@tauri-apps/api/window");
    await getCurrentWindow().destroy();
  }
  /**
   * 关窗口（标题栏按钮、Alt+F4、⌘W、⌘Q）：一直在自动保存，不再问「保存还是不保存」，也不把文件改回去（G1）。
   * 先把没写盘的内容写下去、把还没落定的存档点记下来；这次打开以来有修改的话留一个自动版本。
   */
  async function requestClose() {
    onCaptureSpot(live.current.path);
    await Promise.race([(async () => {
      await flush().catch(() => {});
      await commitCheckpoint().catch(() => {});
      const l = live.current;
      if (be && l.path && l.text !== l.opened) await be.saveVersion(l.path, l.text, "auto", undefined, "关闭时").catch(() => null);
    })(), new Promise((r) => setTimeout(r, 2000))]);
    await reallyClose();
  }
  const closeRef = useRef(requestClose);
  closeRef.current = requestClose;
  useEffect(() => {
    if (!isTauri) return;
    let un: (() => void) | undefined, alive = true;
    import("@tauri-apps/api/window").then(async ({ getCurrentWindow }) => {
      const u = await getCurrentWindow().onCloseRequested((e) => {
        if (closing.current) return;
        e.preventDefault();
        closeRef.current();
      });
      if (alive) un = u; else u();
    });
    return () => { alive = false; un?.(); };
  }, []);

  /* ---------- 正文操作 ---------- */
  /** 点正文下方的空白：光标放到文末；最后一行有字就新起一段 */
  function clickBelow(e: React.MouseEvent) {
    const v = view();
    if (!v || !path || cmpActive || readingOn) return;
    const t = e.target as HTMLElement;
    if (t.closest(".cm-content") || t.closest("button,input,.welcome")) return;
    const contentBottom = v.contentDOM.getBoundingClientRect().bottom;
    if (e.clientY < contentBottom) return;
    e.preventDefault();
    // 新段落前面要有一个空行，否则会被 Markdown 当成上一段（比如列表）的续行
    const docText = v.state.doc.toString();
    const trailing = (docText.match(/\n*$/) || [""])[0].length;
    const need = docText.trim() ? Math.max(0, 2 - trailing) : 0;
    const end = docText.length + need;
    v.dispatch({ changes: need ? { from: docText.length, insert: "\n".repeat(need) } : undefined, selection: { anchor: end }, scrollIntoView: true });
    v.focus();
  }

  function resolveNote(n: Note) {
    const v = view(); if (!v) return;
    v.dispatch({ changes: { from: n.at, to: n.at + n.length, insert: n.quote } });
    say("批注已解决", "success", { label: "撤销", run: () => ed.current?.undo() });
  }

  function applyLayout(l: Record<string, string>) {
    const v = view(); if (!v) return;
    const next = setDocLayout(v.state.doc.toString(), l);
    v.dispatch({ changes: { from: 0, to: v.state.doc.length, insert: next } });
    say(Object.keys(l).some((k) => l[k]) ? "已写入本文属性区" : "已恢复本篇默认显示", "success");
  }

  function pickImage() {
    if (!path) return;
    const inp = document.createElement("input");
    inp.type = "file";
    inp.accept = "image/*";
    inp.multiple = true;
    inp.onchange = () => { const v = view(); if (v && inp.files?.length) insertImages([...inp.files], v.state.selection.main.head); };
    inp.click();
  }

  /** 粘贴或拖进来的图片：存到文档旁的图片文件夹（设置里的「图片保存位置」，默认 assets/），在指定位置插入图片语法 */
  async function insertImages(files: File[], pos: number) {
    const v = view();
    if (!v || !be || !path) return;
    const toB64 = (f: File) => new Promise<string>((res, rej) => { const r = new FileReader(); r.onload = () => res(String(r.result).split(",")[1] || ""); r.onerror = rej; r.readAsDataURL(f); });
    const stamp = () => { const d = new Date(), z = (n: number) => String(n).padStart(2, "0"); return `${d.getFullYear()}${z(d.getMonth() + 1)}${z(d.getDate())}-${z(d.getHours())}${z(d.getMinutes())}${z(d.getSeconds())}`; };
    const parts: string[] = [];
    for (const f of files) {
      const ext = (f.type.split("/")[1] || "png").replace("jpeg", "jpg").replace("svg+xml", "svg");
      const name = f.name && f.name !== "image.png" ? f.name : `图片-${stamp()}.${ext}`;
      try {
        const dest = await be.saveImage(join(dirOf(path), s.imageDir || "assets"), name, await toB64(f));
        parts.push(linkFor(dest, path).text);
      } catch (e) { say(`图片保存失败：${e}`, "error"); }
    }
    if (!parts.length) return;
    // 图片自成一段，光标放到图片后面：图片马上按大图显示，点一下就有缩放控制条
    const ins = blockInsertSpec(v.state.doc.toString(), pos, parts.join("\n\n"));
    v.dispatch({ changes: { from: ins.from, insert: ins.insert }, selection: { anchor: ins.cursor }, scrollIntoView: true });
    v.focus();
    const dirName = s.imageDir || "assets";
    say(parts.length > 1 ? `已插入 ${parts.length} 张图片，保存在 ${dirName}/` : `图片已保存到 ${dirName}/`, "success");
  }

  function insertAtCursor(t: string, block = false) {
    const v = view(); if (!v) return;
    const r = v.state.selection.main;
    if (block) {
      const doc = v.state.doc.toString();
      const ins = blockInsertSpec(doc.slice(0, r.from) + doc.slice(r.to), r.from, t);
      v.dispatch({ changes: { from: r.from, to: r.to, insert: ins.insert }, selection: { anchor: ins.cursor }, scrollIntoView: true });
    } else v.dispatch({ changes: { from: r.from, to: r.to, insert: t }, selection: { anchor: r.from + t.length } });
    v.focus();
  }

  /** N17 复制为带格式的文字：选中的内容，没选中就是全文 */
  function copyFormatted(target: "word" | "wechat") {
    const v = view(); if (!v || !path) return;
    const r = v.state.selection.main;
    const md = r.empty ? v.state.doc.toString() : v.state.sliceDoc(r.from, r.to);
    const what = r.empty ? "全文" : "选中的文字";
    copyRich(md, target, { citeLabel: (k) => citeOne(bibMap.get(k), k), resolveImage, bodyFont: fontStack(layout["body-font"] || s.bodyFont) })
      .then((ok) => say(ok ? (target === "wechat" ? `已复制${what}，可以粘进公众号编辑器` : `已复制${what}，可以粘进 Word 或邮件`) : "没能写进剪贴板"))
      .catch(() => say("没能写进剪贴板"));
  }

  return {
    saveState, flush, openFile, onChange, requestClose,
    clickBelow, resolveNote, applyLayout, pickImage, insertImages, insertAtCursor, copyFormatted,
  };
}
