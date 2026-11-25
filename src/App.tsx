import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { EditorView } from "@codemirror/view";
import { Editor, EditorHandle } from "./editor/Editor";
import { esc } from "./editor/livePreview";
import { Backend, demoImages, demoStartFile, FontFamily, getBackend, isTauri, TreeNode, VersionMeta } from "./lib/backend";
import { alignBlocks, changedLines, countWords, docLayout, headings, Note, parseNotes, plainText, setDocLayout, wordCounter } from "./lib/markdown";
import { loadSettings, saveSettings, Settings, fontStack } from "./lib/settings";
import { BibEntry, parseBib, shortAuthor } from "./lib/bib";
import { FileTree } from "./components/FileTree";
import { FloatingToolbar, Ribbon } from "./components/Toolbars";
import { BlockKind, insertBlock, insertLink, insertNote, setBlock, tableMarkdown, toggleInline } from "./editor/commands";
import { PanelTab, SidePanel, fmtTime, versionTitle } from "./components/SidePanel";
import { Compare } from "./components/Compare";
import { CountPop, HelpDialog, Palette, PaletteItem, SaveVersionDialog, SettingsDialog } from "./components/Dialogs";
import { Icon } from "./components/Icons";

const AUTHOR = "我";
const isMac = typeof navigator !== "undefined" && /Mac/i.test(navigator.platform || navigator.userAgent);
const dirOf = (p: string) => p.replace(/\/[^/]*$/, "");
const baseName = (p: string) => p.split("/").pop() || p;

/** 把 a/b/../c 规范化 */
function normalize(p: string) {
  const out: string[] = [];
  for (const part of p.split("/")) { if (part === "..") out.pop(); else if (part !== "." && part !== "") out.push(part); }
  return (p.startsWith("/") ? "/" : "") + out.join("/");
}
function relative(fromDir: string, to: string) {
  const a = fromDir.split("/").filter(Boolean), b = to.split("/").filter(Boolean);
  let i = 0;
  while (i < a.length && i < b.length && a[i] === b[i]) i++;
  return [...a.slice(i).map(() => ".."), ...b.slice(i)].join("/") || ".";
}
function flatten(nodes: TreeNode[]): TreeNode[] { return nodes.flatMap((n) => (n.dir ? flatten(n.children) : [n])); }

export default function App() {
  const [s, setS] = useState<Settings>(loadSettings);
  const [be, setBe] = useState<Backend | null>(null);
  const [root, setRoot] = useState("");
  const [tree, setTree] = useState<TreeNode[]>([]);
  const [path, setPath] = useState("");
  const [text, setText] = useState("");
  const [saveState, setSaveState] = useState<"saved" | "saving" | "error">("saved");
  const [versions, setVersions] = useState<VersionMeta[]>([]);
  const [fresh, setFresh] = useState<string | null>(null);
  const [cmp, setCmp] = useState<{ v: VersionMeta; against: "current" | "prev"; oldText: string; newText: string } | null>(null);
  const [tab, setTab] = useState<PanelTab>("outline");
  const [showSide, setShowSide] = useState(true);
  const [showPanel, setShowPanel] = useState(true);
  const [focus, setFocus] = useState(false);
  const [dlg, setDlg] = useState<null | "save" | "settings" | "palette" | "cite" | "help_syntax" | "help_keys">(null);
  const [fonts, setFonts] = useState<FontFamily[]>([]);
  const [scrollHeading, setScrollHeading] = useState(0);
  const scroller = useRef<HTMLDivElement>(null);
  const [tick, setTick] = useState(0);
  const [selText, setSelText] = useState("");
  const [cursor, setCursor] = useState(0);
  const [bib, setBib] = useState<BibEntry[]>([]);
  const [countPop, setCountPop] = useState<{ title: string; text: string; rect: DOMRect } | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const ed = useRef<EditorHandle>(null);
  const live = useRef({ path: "", text: "", lastWritten: "", lastVersionAt: 0 });
  const saveTimer = useRef<number>();

  const view = (): EditorView | null => ed.current?.view() ?? null;
  // 方便自动化测试读取编辑器状态
  (window as unknown as { __hm: unknown }).__hm = { view };
  const say = useCallback((m: string) => { setToast(m); window.clearTimeout((say as unknown as { t: number }).t); (say as unknown as { t: number }).t = window.setTimeout(() => setToast(null), 2600); }, []);

  /* ---------- settings & theme ---------- */
  const update = (p: Partial<Settings>) => setS((old) => { const n = { ...old, ...p }; saveSettings(n); return n; });
  useEffect(() => {
    const r = document.documentElement;
    if (s.theme === "system") delete r.dataset.theme; else r.dataset.theme = s.theme;
  }, [s.theme]);

  /* ---------- folder & files ---------- */
  useEffect(() => { getBackend().then(setBe); }, []);
  useEffect(() => { be?.listFonts().then(setFonts).catch(() => setFonts([])); }, [be]);
  useEffect(() => {
    if (!be) return;
    (async () => {
      const pending = await be.takePendingOpen().catch(() => [] as string[]);
      if (pending.length) { await openExternalFile(pending[pending.length - 1]); return; }
      const start = be.isDemo ? dirOf(dirOf(demoStartFile)) : s.lastFolder;
      if (start) await openFolder(start, be.isDemo ? demoStartFile : undefined).catch(() => update({ lastFolder: "" }));
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [be]);

  async function openFolder(dir: string, file?: string) {
    if (!be) return;
    const t = await be.openFolder(dir);
    setRoot(dir); setTree(t); update({ lastFolder: dir });
    const files = flatten(t);
    const bibs = files.filter((f) => f.name.endsWith(".bib"));
    const entries = (await Promise.all(bibs.map((b) => be.readText(b.path).catch(() => "")))).flatMap(parseBib);
    setBib(entries);
    const first = file || files.find((f) => f.name.endsWith(".md"))?.path;
    if (first) await openFile(first);
  }
  /** 从 Finder 打开的文件：在当前文件夹里就直接打开，否则把它所在的文件夹作为工作区 */
  async function openExternalFile(p: string) {
    if (root && p.startsWith(root + "/")) await openFile(p);
    else await openFolder(dirOf(p), p);
  }
  useEffect(() => {
    if (!be) return;
    return be.onOpenFile(async () => {
      const ps = await be.takePendingOpen();
      if (ps.length) await openExternalFile(ps[ps.length - 1]);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [be, root]);
  async function newFile() {
    if (!be || !root) { await chooseFolder(); return; }
    const p = await be.createFile(path ? dirOf(path) : root, "未命名");
    setTree(await be.listTree(root));
    await openFile(p);
    const v = view();
    if (v) { v.focus(); v.dispatch({ selection: { anchor: v.state.doc.length } }); }
  }
  async function chooseFolder() {
    if (!be) return;
    const d = await be.pickFolder();
    if (d) await openFolder(d);
  }

  async function flush() {
    window.clearTimeout(saveTimer.current);
    const l = live.current;
    if (be && l.path && l.text !== l.lastWritten) {
      await be.writeText(l.path, l.text);
      l.lastWritten = l.text;
      setSaveState("saved");
    }
  }

  async function openFile(p: string) {
    if (!be) return;
    await flush();
    const content = await be.readText(p);
    live.current = { path: p, text: content, lastWritten: content, lastVersionAt: Date.now() };
    setPath(p); setText(content); setCmp(null); setFresh(null);
    ed.current?.load(content);
    if (scroller.current) scroller.current.scrollTop = 0;
    setScrollHeading(0);
    // 打开时留一个基线版本，之后的任何修改都能回到这里
    await be.saveVersion(p, content, "auto").catch(() => null);
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
      if (!l.path || Date.now() - l.lastVersionAt < s.autoMinutes * 60_000) return;
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
      if (content === live.current.text) return;
      const before = live.current.text;
      live.current.text = content; live.current.lastWritten = content;
      ed.current?.replace(content);
      ed.current?.flash(changedLines(before, content));
      setText(content);
      const vs = await be.listVersions(p);
      setVersions(vs);
      setFresh(vs[0]?.id ?? null);
    });
  }, [be]);

  useEffect(() => {
    const f = () => { flush(); };
    addEventListener("beforeunload", f);
    return () => removeEventListener("beforeunload", f);
  });

  /* ---------- derived ---------- */
  const layout = useMemo(() => docLayout(text), [text]);
  const notes = useMemo<Note[]>(() => parseNotes(text), [text]);
  const hs = useMemo(() => headings(text), [text]);
  // 大纲高亮跟随正文滚动位置
  const lockHeading = useRef(0);
  const syncScrollHeading = useCallback(() => {
    const v = view(), sc = scroller.current;
    if (!v || !sc || Date.now() < lockHeading.current) return;
    const top = sc.getBoundingClientRect().top + 80;
    let c = 0;
    hs.forEach((h, i) => {
      if (h.pos > v.state.doc.length) return;
      const y = v.lineBlockAt(h.pos).top + v.documentTop;
      if (y <= top) c = i;
    });
    setScrollHeading(c);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hs]);
  useEffect(() => { syncScrollHeading(); }, [syncScrollHeading]);
  const currentHeading = scrollHeading;
  const count = useCallback((t: string, p: boolean) => countWords(t, p), []);
  const totalCounter = useMemo(wordCounter, []);
  const total = useMemo(() => totalCounter(text, s.countPunct), [totalCounter, text, s.countPunct]);
  const stats = useMemo(() => {
    const secs = hs.filter((h) => h.level <= 2);
    let sec = 0;
    const cur = [...secs].reverse().find((h) => h.pos <= cursor);
    if (cur) { const next = secs.find((h) => h.pos > cur.pos); sec = countWords(plainText(text.slice(cur.pos, next ? next.pos : undefined)), s.countPunct); }
    return { total, sec };
  }, [total, text, hs, cursor, s.countPunct]);

  const bibMap = useMemo(() => new Map(bib.map((b) => [b.key, b])), [bib]);
  const preview = useMemo(() => ({
    syntax: () => s.syntax,
    citeLabel: (k: string) => { const b = bibMap.get(k); return b ? `${shortAuthor(b.author)}, ${b.year}` : "@" + k; },
    resolveImage: (src: string) => {
      if (/^(https?:|data:)/.test(src)) return src;
      const abs = normalize(dirOf(live.current.path) + "/" + decodeURI(src));
      if (!isTauri && demoImages.has(abs)) return demoImages.get(abs)!;
      if (isTauri) return (window as unknown as { __TAURI_INTERNALS__: { convertFileSrc: (p: string) => string } }).__TAURI_INTERNALS__.convertFileSrc(abs);
      return abs;
    },
  }), [s.syntax, bibMap]);
  const previewKey = `${s.syntax}|${bib.length}`;

  const editorStyle = {
    "--ed-h": fontStack(layout["heading-font"] || s.headingFont),
    "--ed-b": fontStack(layout["body-font"] || s.bodyFont),
    "--ed-size": `${+layout["font-size"] || s.fontSize}px`,
    "--ed-lh": String(+layout["line-height"] || s.lineHeight),
    "--measure": `${+layout["measure"] || s.measure}em`,
  } as React.CSSProperties;

  // 光标和选区的变化合并到每帧最多一次界面更新
  const selFrame = useRef(0);
  const onSelection = useCallback((v: EditorView) => {
    if (selFrame.current) return;
    selFrame.current = requestAnimationFrame(() => {
      selFrame.current = 0;
      const r = v.state.selection.main;
      setCursor(r.head);
      setSelText(r.empty ? "" : v.state.sliceDoc(r.from, r.to));
      setTick((t) => t + 1);
    });
  }, []);

  /** 点正文下方的空白：光标放到文末；最后一行有字就新起一段 */
  function clickBelow(e: React.MouseEvent) {
    const v = view();
    if (!v || !path || cmp) return;
    const t = e.target as HTMLElement;
    if (t.closest(".cm-content") || t.closest("button,input,.welcome")) return;
    const contentBottom = v.contentDOM.getBoundingClientRect().bottom;
    if (e.clientY < contentBottom) return;
    e.preventDefault();
    // 新段落前面要有一个空行，否则会被 Markdown 当成上一段（比如列表）的续行
    const text = v.state.doc.toString();
    const trailing = (text.match(/\n*$/) || [""])[0].length;
    const need = text.trim() ? Math.max(0, 2 - trailing) : 0;
    const end = text.length + need;
    v.dispatch({ changes: need ? { from: text.length, insert: "\n".repeat(need) } : undefined, selection: { anchor: end }, scrollIntoView: true });
    v.focus();
  }

  /* ---------- 菜单 ---------- */
  function onMenu(id: string) {
    const v = view();
    const ae = document.activeElement as HTMLElement | null;
    const inField = !!ae && (ae.tagName === "INPUT" || ae.tagName === "TEXTAREA" || (ae.isContentEditable && !ae.classList.contains("cm-content")));
    if (id === "undo" || id === "redo") {
      if (inField) document.execCommand(id);
      else if (id === "undo") ed.current?.undo(); else ed.current?.redo();
      return;
    }
    const block = id.startsWith("block_") ? (id.slice(6) as BlockKind) : null;
    if (block) { if (v) setBlock(v, block); return; }
    const inline = { bold: "bold", italic: "italic", strike: "strike", code: "code", math: "math" } as const;
    if (id in inline) { if (v) toggleInline(v, inline[id as keyof typeof inline]); return; }
    switch (id) {
      case "settings": setDlg("settings"); break;
      case "new_file": newFile(); break;
      case "open_folder": chooseFolder(); break;
      case "save_version": if (path) setDlg("save"); break;
      case "find": ed.current?.find(); break;
      case "search": setDlg((d) => (d === "palette" ? null : "palette")); break;
      case "link": if (v) insertLink(v); break;
      case "cite": setDlg("cite"); break;
      case "note": if (v && !insertNote(v, AUTHOR)) say("先选中要批注的文字"); break;
      case "insert_table": if (v) insertBlock(v, tableMarkdown(2, 3), 2); break;
      case "insert_code": if (v) insertBlock(v, "```\n\n```", 4); break;
      case "insert_math": if (v) insertBlock(v, "$$\n\n$$", 3); break;
      case "insert_mermaid": if (v) insertBlock(v, "```mermaid\nflowchart LR\n  A[开始] --> B[结束]\n```", 11); break;
      case "insert_image": pickImage(); break;
      case "insert_hr": if (v) insertBlock(v, "---"); break;
      case "toggle_side": setShowSide((x) => !x); break;
      case "toggle_panel": setShowPanel((x) => !x); break;
      case "toggle_ribbon": update({ ribbonCollapsed: !s.ribbonCollapsed }); break;
      case "focus": setFocus((x) => !x); break;
      case "panel_outline": setShowPanel(true); setTab("outline"); break;
      case "panel_notes": setShowPanel(true); setTab("notes"); break;
      case "panel_versions": setShowPanel(true); setTab("versions"); break;
      case "toggle_syntax": update({ syntax: s.syntax === "always" ? "active" : "always" }); break;
      case "help_syntax": setDlg("help_syntax"); break;
      case "help_keys": setDlg("help_keys"); break;
    }
  }
  const menuRef = useRef(onMenu);
  menuRef.current = onMenu;
  useEffect(() => { if (be) return be.onMenu((id) => menuRef.current(id)); }, [be]);

  // 原生应用没有网页右键菜单；正文和输入框里保留系统的拷贝粘贴菜单
  useEffect(() => {
    if (!isTauri) return;
    const f = (e: MouseEvent) => {
      const t = e.target as HTMLElement;
      if (!t.closest(".cm-content, input, textarea, [contenteditable=true]")) e.preventDefault();
    };
    addEventListener("contextmenu", f);
    return () => removeEventListener("contextmenu", f);
  }, []);

  /* ---------- actions ---------- */
  /** 跳到某个位置，并把它滚到顶部（不是刚好露出在底部） */
  function jump(pos: number) {
    const v = view(); if (!v) return;
    setCmp(null);
    const at = Math.min(pos, v.state.doc.length);
    const hi = hs.findIndex((h) => h.pos === pos);
    if (hi >= 0) { setScrollHeading(hi); lockHeading.current = Date.now() + 900; }
    v.dispatch({ selection: { anchor: at }, effects: EditorView.scrollIntoView(at, { y: "start", yMargin: 28 }) });
    v.focus();
  }
  function resolveNote(n: Note) {
    const v = view(); if (!v) return;
    v.dispatch({ changes: { from: n.at, to: n.at + n.length, insert: n.quote } });
    say("批注已解决，文件里的批注标记已移除");
  }
  function applyLayout(l: Record<string, string>) {
    const v = view(); if (!v) return;
    const next = setDocLayout(v.state.doc.toString(), l);
    v.dispatch({ changes: { from: 0, to: v.state.doc.length, insert: next } });
    say(Object.keys(l).some((k) => l[k]) ? "已写入本文属性区" : "已清除本文版式");
  }
  async function saveVersion(name: string, note: string) {
    if (!be || !path) return;
    await flush();
    await be.saveVersion(path, live.current.text, "saved", name, note || undefined);
    live.current.lastVersionAt = Date.now();
    setVersions(await be.listVersions(path));
    setDlg(null);
    say(`已保存版本「${name}」`);
  }
  async function openVersion(id: string, against: "current" | "prev" = "current") {
    if (!be) return;
    const i = versions.findIndex((x) => x.id === id);
    const v = versions[i];
    const content = await be.readVersion(path, id);
    if (fresh === id) setFresh(null);
    if (against === "prev" && versions[i + 1]) setCmp({ v, against, oldText: await be.readVersion(path, versions[i + 1].id), newText: content });
    else setCmp({ v, against: "current", oldText: content, newText: live.current.text });
  }
  async function restore() {
    if (!be || !cmp) return;
    await flush();
    await be.saveVersion(path, live.current.text, "auto", undefined, "恢复前自动保存");
    const content = await be.readVersion(path, cmp.v.id);
    const before = live.current.text;
    ed.current?.replace(content);
    window.setTimeout(() => ed.current?.flash(changedLines(before, content)), 50);
    live.current.text = content;
    setText(content);
    await flush();
    setVersions(await be.listVersions(path));
    setCmp(null);
    say(`已恢复到「${versionTitle(cmp.v)}」，恢复前的内容已存为版本`);
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
  /** 粘贴或拖进来的图片：存到文档旁的 assets/，在指定位置插入图片语法 */
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
        const dest = await be.saveImage(dirOf(path) + "/assets", name, await toB64(f));
        parts.push(`![${baseName(dest).replace(/\.[^.]+$/, "")}](${encodeURI(relative(dirOf(path), dest))})`);
      } catch (e) { say(`图片保存失败：${e}`); }
    }
    if (!parts.length) return;
    const line = v.state.doc.lineAt(pos);
    const before = line.text.slice(0, pos - line.from).trim() ? "\n\n" : "";
    const after = line.text.slice(pos - line.from).trim() ? "\n\n" : "";
    const insert = before + parts.join("\n\n") + after;
    v.dispatch({ changes: { from: pos, insert }, selection: { anchor: pos + insert.length }, scrollIntoView: true });
    v.focus();
    say(parts.length > 1 ? `已插入 ${parts.length} 张图片，保存在 assets/` : "图片已保存到 assets/");
  }
  function insertAtCursor(t: string, block = false) {
    const v = view(); if (!v) return;
    const r = v.state.selection.main;
    const ins = block ? `\n\n${t}\n\n` : t;
    v.dispatch({ changes: { from: r.from, to: r.to, insert: ins }, selection: { anchor: r.from + ins.length } });
    v.focus();
  }

  /* ---------- search ---------- */
  const folderCache = useRef<Map<string, string>>(new Map());
  useEffect(() => { folderCache.current.clear(); }, [root]);
  const [folderTexts, setFolderTexts] = useState<Map<string, string>>(new Map());
  useEffect(() => {
    if (dlg !== "palette" || !be) return;
    (async () => {
      const files = flatten(tree).filter((f) => f.name.endsWith(".md") && f.path !== path);
      for (const f of files) if (!folderCache.current.has(f.path)) folderCache.current.set(f.path, await be.readText(f.path).catch(() => ""));
      setFolderTexts(new Map(folderCache.current));
    })();
  }, [dlg, be, tree, path]);
  const snip = (t: string, q: string) => {
    const i = t.toLowerCase().indexOf(q.toLowerCase());
    const a = Math.max(0, i - 16), b = Math.min(t.length, i + q.length + 30);
    return (a ? "…" : "") + esc(t.slice(a, i)) + "<b>" + esc(t.substr(i, q.length)) + "</b>" + esc(t.slice(i + q.length, b)) + (b < t.length ? "…" : "");
  };
  const search = useCallback((q: string): PaletteItem[] => {
    const out: PaletteItem[] = [];
    const ql = q.toLowerCase();
    let pos = 0;
    for (const line of text.split("\n")) {
      const p = plainText(line);
      if (p.toLowerCase().includes(ql) && out.length < 6) {
        const at = pos;
        const h = [...hs].reverse().find((x) => x.pos <= at);
        out.push({ group: "当前文件", icon: "doc", title: h ? h.text : baseName(path), sub: snip(p, q), run: () => jump(at) });
      }
      pos += line.length + 1;
    }
    let n = 0;
    folderTexts.forEach((t, p) => {
      const pt = plainText(t);
      if (n < 6 && (pt.toLowerCase().includes(ql) || baseName(p).toLowerCase().includes(ql))) {
        n++;
        out.push({ group: "文件夹", icon: "file", title: relative(root, p), sub: pt.toLowerCase().includes(ql) ? snip(pt, q) : undefined, run: () => openFile(p) });
      }
    });
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [text, hs, folderTexts, root, path]);

  const commands: PaletteItem[] = [
    { group: "命令", icon: "cmd", title: "保存版本", keys: ["⌘", "S"], run: () => setDlg("save") },
    { group: "命令", icon: "cmd", title: "插入引用（文献或文件）", run: () => setTimeout(() => setDlg("cite"), 0) },
    { group: "命令", icon: "cmd", title: "打开文件夹…", keys: ["⌘", "O"], run: chooseFolder },
    { group: "命令", icon: "cmd", title: "新建文稿", keys: ["⌘", "N"], run: newFile },
    { group: "命令", icon: "cmd", title: "Markdown 语法速查", run: () => setTimeout(() => setDlg("help_syntax"), 0) },
    { group: "命令", icon: "cmd", title: "设置", keys: ["⌘", ","], run: () => setDlg("settings") },
    { group: "命令", icon: "cmd", title: "专注模式", keys: ["⌘", "⇧", "F"], run: () => setFocus((f) => !f) },
    ...hs.filter((h) => h.level >= 2).map((h) => ({ group: "跳转", icon: "go", title: h.text, run: () => jump(h.pos) })),
  ];
  const citeItems: PaletteItem[] = [
    ...bib.map((b) => ({ group: "文献", icon: "cite", title: `${shortAuthor(b.author)}, ${b.year}`, sub: esc(`@${b.key} · ${b.title}`), run: () => insertAtCursor(`[@${b.key}]`) })),
    ...flatten(tree).filter((f) => f.path !== path).map((f) => ({ group: "文件", icon: "file", title: relative(root, f.path), run: () => insertAtCursor(`[${f.name}](${encodeURI(relative(dirOf(path), f.path))})`) })),
  ];

  /* ---------- keyboard ---------- */
  useEffect(() => {
    const f = (e: KeyboardEvent) => {
      const mod = e.metaKey || e.ctrlKey, k = e.key.toLowerCase();
      if (mod && k === "k") { e.preventDefault(); setDlg((d) => (d === "palette" ? null : "palette")); }
      else if (mod && k === "s") { e.preventDefault(); if (path) setDlg("save"); }
      else if (mod && (k === "," || e.code === "Comma")) { e.preventDefault(); setDlg("settings"); }
      else if (mod && e.shiftKey && k === "f") { e.preventDefault(); setFocus((x) => !x); }
      else if (mod && e.key === "\\") { e.preventDefault(); setShowSide((x) => !x); }
      else if (mod && e.key === "/") { e.preventDefault(); setShowPanel((x) => !x); }
      else if (mod && k === "n") { e.preventDefault(); newFile(); }
      else if (mod && k === "o") { e.preventDefault(); chooseFolder(); }
      else if (e.key === "Escape" && !dlg) { if (cmp) setCmp(null); else if (focus) setFocus(false); }
    };
    addEventListener("keydown", f);
    return () => removeEventListener("keydown", f);
  });

  const changesSinceLast = useMemo(() => 0, []);
  const [lastVersionText, setLastVersionText] = useState("");
  useEffect(() => { if (dlg === "save" && be && versions[0]) be.readVersion(path, versions[0].id).then(setLastVersionText); }, [dlg, be, versions, path]);
  const saveChanges = useMemo(() => (dlg === "save" ? alignBlocks(lastVersionText, text).filter((r) => r.ops).length : changesSinceLast), [dlg, lastVersionText, text, changesSinceLast]);

  const appCls = ["app", showSide ? "" : "no-side", showPanel ? "" : "no-panel", focus ? "focus" : "", isTauri && isMac ? "mac" : ""].join(" ");
  const fileName = baseName(path);
  const crumbs = path && root ? relative(root, path).split("/") : [];

  return (
    <div className={appCls} style={editorStyle}>
      <header className="titlebar" data-tauri-drag-region>
        <button className="ib" title="切换侧栏 ⌘\" aria-label="切换侧栏" onClick={() => setShowSide(!showSide)}><Icon name="side" /></button>
        <div className="crumbs" data-tauri-drag-region>
          {root && <span>{baseName(root)}</span>}
          {crumbs.map((c, i) => <span key={i} className="crumb"><span className="sep">/</span>{i === crumbs.length - 1 ? <b>{c}</b> : c}</span>)}
        </div>
        <div className="spacer" data-tauri-drag-region />
        {path && <div className={"savestate " + saveState}><i />{saveState === "saving" ? "保存中" : saveState === "error" ? "保存失败" : "已保存"}</div>}
        <button className="searchbtn" onClick={() => setDlg("palette")} aria-label="搜索或执行命令"><Icon name="search" size={14} /><span className="lbl">搜索</span><kbd>⌘K</kbd></button>
        <button className={"ib" + (focus ? " on" : "")} title="专注 ⌘⇧F" aria-label="专注模式" onClick={() => setFocus(!focus)}><Icon name="focus" /></button>
        <button className="ib primary" title="导出功能在下一阶段实现" disabled>导出</button>
        <button className="ib" title="切换右栏 ⌘/" aria-label="切换右栏" onClick={() => setShowPanel(!showPanel)}><Icon name="panel" /></button>
      </header>

      <aside className="side" aria-label="文件夹">
        <div className="side-in">
          <div className="side-scroll">
            <button className="folder" onClick={chooseFolder} title="打开其他文件夹">
              <span className="fi"><Icon name="folder" size={14} /></span>
              <span><b>{root ? baseName(root) : "打开文件夹"}</b><small>{root || "选择一个放稿件的文件夹"}</small></span>
            </button>
            <FileTree nodes={tree} current={path} onOpen={openFile} showAll={s.showAllFiles} />
          </div>
          <div className="side-foot"><button className="tn" onClick={() => setDlg("settings")}><span className="ico"><Icon name="gear" size={14} /></span><span className="nm">设置</span><span className="ext">⌘,</span></button></div>
        </div>
      </aside>

      <main className="main">
        <Ribbon view={ed.current?.view() ?? null} author={AUTHOR} settings={s} fonts={fonts} layout={layout} onLayout={applyLayout}
          collapsed={s.ribbonCollapsed} setCollapsed={(c) => update({ ribbonCollapsed: c })}
          onSaveVersion={() => setDlg("save")} onPickImage={pickImage} onCite={() => setDlg("cite")} />
        <div className="scroller" ref={scroller} onScroll={() => window.requestAnimationFrame(syncScrollHeading)} onMouseDown={clickBelow}>
          <div className="doc">
            {!path && <div className="welcome"><h2>HolyMark</h2><p>打开一个放稿件的文件夹开始写作。文件就是普通的 Markdown，换任何编辑器都能打开。</p><button className="btn acc" onClick={chooseFolder}>打开文件夹</button></div>}
            <div hidden={!path}><Editor ref={ed} initial="" preview={preview} previewKey={previewKey} onChange={onChange} onSelection={onSelection} onImages={insertImages} /></div>
          </div>
        </div>
        <FloatingToolbar view={ed.current?.view() ?? null} tick={tick} author={AUTHOR} />
        {cmp && (
          <Compare version={cmp.v} oldText={cmp.oldText} newText={cmp.newText} against={cmp.against}
            hasPrev={versions.findIndex((x) => x.id === cmp.v.id) < versions.length - 1}
            prevLabel={(() => { const p = versions[versions.findIndex((x) => x.id === cmp.v.id) + 1]; if (!p) return ""; const t = fmtTime(p.at); return `${versionTitle(p)} · ${t.day} ${t.hm}`; })()}
            onAgainst={(a) => openVersion(cmp.v.id, a)} onClose={() => setCmp(null)} onRestore={restore} />
        )}
      </main>

      <aside className="panel" aria-label="当前文件">
        <SidePanel tab={tab} setTab={setTab} headings={hs} currentHeading={currentHeading} notes={notes} versions={versions} freshVersion={fresh}
          selectedVersion={cmp?.v.id ?? null} fileName={fileName} onJump={jump} onResolve={resolveNote}
          onOpenVersion={(id) => openVersion(id)} onSaveVersion={() => setDlg("save")} />
      </aside>

      <footer className="statusbar">
        <span className="sb">本节 <b>{stats.sec.toLocaleString()}</b></span>
        <button className="sb" onClick={(e) => setCountPop({ title: "全文", text: plainText(text), rect: e.currentTarget.getBoundingClientRect() })}>全文 <b>{stats.total.toLocaleString()}</b></button>
        {selText && <button className="sb sel" onMouseDown={(e) => e.preventDefault()} onClick={(e) => setCountPop({ title: "选中的文字", text: plainText(selText), rect: e.currentTarget.getBoundingClientRect() })}>选中 <b>{countWords(plainText(selText), s.countPunct).toLocaleString()}</b></button>}
        {s.goalOn && <div className="r"><div className="goalbar"><i style={{ width: `${Math.min(100, (stats.total / s.goal) * 100)}%` }} /></div><span className="sb"><b>{stats.total.toLocaleString()} / {s.goal.toLocaleString()}</b></span></div>}
        {be?.isDemo && <span className="sb demo-tag">浏览器预览 · 演示文件夹</span>}
      </footer>

      {countPop && <CountPop title={countPop.title} text={countPop.text} count={count} anchor={countPop.rect} onClose={() => setCountPop(null)} />}
      {dlg === "save" && <SaveVersionDialog changes={saveChanges} fileName={fileName} onSave={saveVersion} onClose={() => setDlg(null)} />}
      {dlg === "settings" && <SettingsDialog s={s} fonts={fonts} onChange={update} onClose={() => setDlg(null)} />}
      {(dlg === "help_syntax" || dlg === "help_keys") && <HelpDialog kind={dlg === "help_syntax" ? "syntax" : "keys"} onClose={() => setDlg(null)} />}
      {dlg === "palette" && <Palette items={commands} search={search} onClose={() => setDlg(null)} placeholder="搜索全文、文件夹，或输入命令" />}
      {dlg === "cite" && <Palette items={citeItems} search={() => []} onClose={() => setDlg(null)} placeholder="搜索文献或文件，回车插入" />}
      {toast && <div className="toast" role="status"><i />{toast}</div>}
    </div>
  );
}
