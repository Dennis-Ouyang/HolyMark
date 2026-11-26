import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { EditorView } from "@codemirror/view";
import { Editor, EditorHandle } from "./editor/Editor";
import { Backend, demoImages, demoStartFile, FontFamily, getBackend, isTauri, TreeNode, VersionMeta } from "./lib/backend";
import { alignBlocks, changedLines, countWords, docLayout, headings, Note, parseNotes, plainText, setDocLayout, wordCounter } from "./lib/markdown";
import { applyAccent, loadSettings, saveSettings, Settings, fontStack } from "./lib/settings";
import { BibEntry, parseBib, shortAuthor } from "./lib/bib";
import { FileTree } from "./components/FileTree";
import { FloatingToolbar, Ribbon } from "./components/Toolbars";
import { activeStyles, BlockKind, blockInsertSpec, currentBlock, indentList, InlineKind, shiftHeading, insertBlock, insertLink, insertNote, setBlock, tableMarkdown, toggleInline } from "./editor/commands";
import { PanelTab, SidePanel, fmtTime, versionTitle } from "./components/SidePanel";
import { Compare } from "./components/Compare";
import { CountPop, HelpDialog, Palette, PaletteItem, SaveVersionDialog, SettingsDialog, UnsavedDialog } from "./components/Dialogs";
import { Icon } from "./components/Icons";
import { Presence } from "./components/Presence";
import { WindowControls } from "./components/WindowControls";
import { Menu, MenuEntry } from "./components/Menu";
import { SearchPanel } from "./components/Search";
import { InsertFile, InsertPick, linkFor } from "./components/InsertFile";
import { baseName, dirOf, isInside, isMarkdown, join, normalize, relative, toPosix } from "./lib/paths";
import { isMac, isWindows, kbd, keyName } from "./lib/platform";
import { menuIdFor } from "./lib/shortcuts";
import { ExportDialog } from "./components/ExportDialog";
import { NoticeAction, NoticeKind, setNotifier } from "./editor/notice";

const AUTHOR = "我";
/** macOS 有原生菜单负责快捷键；Windows 和浏览器预览里由前端处理 */
const nativeMenu = isTauri && isMac;
/** Windows 上不用系统标题栏，窗口按钮自己画 */
const customFrame = isTauri && isWindows;
function flatten(nodes: TreeNode[]): TreeNode[] { return nodes.flatMap((n) => (n.dir ? flatten(n.children) : [n])); }
/** 侧栏里显示的路径：太长时只留后半段 */
function shortPath(p: string) { return p.length > 38 ? "…" + p.slice(-37) : p; }

/** 开始页：没有打开文件夹（或文件夹里还没有文稿）时显示 */
function Welcome({ hasRoot, recent, onOpen, onNew, onRecent }: { hasRoot: boolean; recent: string[]; onOpen: () => void; onNew: () => void; onRecent: (f: string) => void }) {
  return (
    <div className="welcome">
      <h2>HolyMark</h2>
      <p>{hasRoot ? "这个文件夹里还没有 Markdown 文稿。" : "选择一个文件夹作为你的工作区。"}</p>
      <div className="w-acts">
        {hasRoot ? <button className="btn acc" onClick={onNew}>新建文稿</button> : <button className="btn acc" onClick={onOpen}>打开文件夹…</button>}
      </div>
      {!hasRoot && recent.length > 0 && <div className="w-recent">
        <div className="w-h">最近打开</div>
        {recent.slice(0, 6).map((f) => (
          <button key={f} className="w-item" onClick={() => onRecent(f)} title={f}>
            <Icon name="folder" size={15} /><b>{baseName(f)}</b><small>{dirOf(f)}</small>
          </button>
        ))}
      </div>}
    </div>
  );
}

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
  /** same：这个版本和现在的内容一样 */
  const [cmp, setCmp] = useState<{ v: VersionMeta; against: "current" | "prev"; same?: boolean; oldText: string; newText: string } | null>(null);
  /** 和另一个文件对比 */
  const [fileCmp, setFileCmp] = useState<{ name: string; text: string } | null>(null);
  /** 文件树：右键菜单、改名中的路径、移动中的路径 */
  const [treeMenu, setTreeMenu] = useState<{ x: number; y: number; node: TreeNode | null } | null>(null);
  const [folderMenu, setFolderMenu] = useState<{ x: number; y: number } | null>(null);
  const [renaming, setRenaming] = useState<string | null>(null);
  const [moving, setMoving] = useState<TreeNode | null>(null);
  const [tab, setTab] = useState<PanelTab>("outline");
  const [showSide, setShowSide] = useState(true);
  const [showPanel, setShowPanel] = useState(true);
  const [focus, setFocus] = useState(false);
  const [dlg, setDlg] = useState<null | "save" | "settings" | "palette" | "help_syntax" | "help_keys" | "export" | "unsaved" | "cmpfile" | "move">(null);
  const [fonts, setFonts] = useState<FontFamily[]>([]);
  const [scrollHeading, setScrollHeading] = useState(0);
  const scroller = useRef<HTMLDivElement>(null);
  const [tick, setTick] = useState(0);
  const [selText, setSelText] = useState("");
  /** 光标处的行内格式和段落类型，工具栏按钮显示按下状态 */
  const [fmt, setFmt] = useState<{ active: Set<InlineKind>; block: BlockKind }>({ active: new Set(), block: "p" });
  const [cursor, setCursor] = useState(0);
  const [bib, setBib] = useState<BibEntry[]>([]);
  const [countPop, setCountPop] = useState<{ title: string; text: string; rect: DOMRect } | null>(null);
  const [toast, setToast] = useState<{ msg: string; kind: NoticeKind; action?: NoticeAction } | null>(null);
  const ed = useRef<EditorHandle>(null);
  // base：上一次“保存”时的内容（打开文件、保存版本、外部修改之后）。和 text 不同就是有没保存的修改，关闭应用时会问
  const live = useRef({ path: "", text: "", base: "", lastWritten: "", lastVersionAt: 0 });
  const saveTimer = useRef<number>();

  const view = (): EditorView | null => ed.current?.view() ?? null;
  // 方便自动化测试读取编辑器状态
  (window as unknown as { __hm: unknown }).__hm = { view, menu: (id: string) => menuRef.current(id) };
  /** 提示条。kind 决定前面小圆点的颜色：success 绿、warn 琥珀、error 红，info 不带点 */
  const say = useCallback((m: string, kind: NoticeKind = "info", action?: NoticeAction) => {
    setToast({ msg: m, kind, action });
    window.clearTimeout((say as unknown as { t: number }).t);
    (say as unknown as { t: number }).t = window.setTimeout(() => setToast(null), action ? 6000 : 2600);
  }, []);

  useEffect(() => { setNotifier(say); }, [say]);

  /* ---------- settings & theme ---------- */
  const update = (p: Partial<Settings>) => setS((old) => { const n = { ...old, ...p }; saveSettings(n); return n; });
  useEffect(() => {
    const r = document.documentElement;
    if (s.theme === "system") delete r.dataset.theme; else r.dataset.theme = s.theme;
  }, [s.theme]);
  // 主题色：浅色、深色界面各用一套，跟随系统时系统切换也要跟着换
  useEffect(() => {
    const mq = matchMedia("(prefers-color-scheme: dark)");
    const f = () => applyAccent(s.accent, s.theme === "dark" || (s.theme === "system" && mq.matches));
    f();
    mq.addEventListener("change", f);
    return () => mq.removeEventListener("change", f);
  }, [s.accent, s.theme]);

  /* ---------- folder & files ---------- */
  useEffect(() => { getBackend().then(setBe); }, []);
  useEffect(() => { be?.listFonts().then(setFonts).catch(() => setFonts([])); }, [be]);
  useEffect(() => {
    if (!be) return;
    (async () => {
      const pending = await be.takePendingOpen().catch(() => [] as string[]);
      if (pending.length) { await openExternalFile(pending[pending.length - 1]); return; }
      const start = be.isDemo ? dirOf(dirOf(demoStartFile)) : s.reopenLast ? s.lastFolder : "";
      if (start) await openFolder(start, be.isDemo ? demoStartFile : undefined).catch(() => update({ lastFolder: "" }));
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [be]);

  async function openFolder(dir: string, file?: string) {
    if (!be) return;
    const t = await be.openFolder(dir);
    setRoot(dir); setTree(t); update({ lastFolder: dir, recentFolders: [dir, ...s.recentFolders.filter((x) => x !== dir)].slice(0, 8) });
    const files = flatten(t);
    const bibs = files.filter((f) => f.name.endsWith(".bib"));
    const entries = (await Promise.all(bibs.map((b) => be.readText(b.path).catch(() => "")))).flatMap(parseBib);
    setBib(entries);
    const first = file || files.find((f) => isMarkdown(f.name))?.path;
    if (first) await openFile(first);
  }
  /** 从访达或资源管理器打开的文件：在当前文件夹里就直接打开，否则把它所在的文件夹作为工作区 */
  async function openExternalFile(p: string) {
    if (isInside(root, p)) await openFile(p);
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
  async function newFile(dir?: string) {
    if (!be || !root) { await chooseFolder(); return; }
    const prev = live.current.path;
    const p = await be.createFile(dir ?? (path ? dirOf(path) : root), "未命名");
    setTree(await be.listTree(root));
    await openFile(p);
    undoable(`已新建「${baseName(p)}」`, async () => { await be.trashPath(p); if (prev) await openFile(prev); });
    const v = view();
    if (v) { v.focus(); v.dispatch({ selection: { anchor: v.state.doc.length } }); }
  }
  /** 关闭文件夹，回到开始页；下次启动也从开始页开始，直到再打开一个文件夹 */
  async function closeFolder() {
    if (!be || !root) return;
    await flush().catch(() => {});
    await Promise.all([...staged.current.keys()].map((p) => { window.clearTimeout(staged.current.get(p)); return be.commitStaged(p).catch(() => {}); }));
    staged.current.clear();
    await be.closeFolder().catch(() => {});
    live.current = { path: "", text: "", base: "", lastWritten: "", lastVersionAt: 0 };
    ed.current?.load("");
    setRoot(""); setTree([]); setPath(""); setText(""); setVersions([]); setCmp(null); setFileCmp(null); setBib([]);
    update({ lastFolder: "" });
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
    live.current = { path: p, text: content, base: content, lastWritten: content, lastVersionAt: Date.now() };
    setPath(p); setText(content); setCmp(null); setFileCmp(null); setFresh(null);
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
      live.current.text = content; live.current.lastWritten = content; live.current.base = content;
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

  /* ---------- 关闭应用：有修改时问一声要不要保存 ---------- */
  const closing = useRef(false);
  async function reallyClose() {
    closing.current = true;
    await Promise.all([...staged.current.keys()].map((p) => { window.clearTimeout(staged.current.get(p)); return be?.commitStaged(p).catch(() => {}); }));
    staged.current.clear();
    setDlg(null);
    if (!isTauri) { closing.current = false; say("浏览器预览里不会真的关闭窗口"); return; }
    const { getCurrentWindow } = await import("@tauri-apps/api/window");
    await getCurrentWindow().destroy();
  }
  /** 关窗口（标题栏按钮、Alt+F4、⌘W、⌘Q）：先把没写盘的内容存下来，再看要不要问 */
  async function requestClose() {
    await Promise.race([flush().catch(() => {}), new Promise((r) => setTimeout(r, 2000))]);
    const l = live.current;
    if (s.askOnClose && l.path && l.text !== l.base) { setDlg("unsaved"); return; }
    await reallyClose();
  }
  /** 保存：文件已经是现在的内容，记一个版本作为保存点 */
  async function closeSaving() {
    const l = live.current;
    if (be && l.path) await be.saveVersion(l.path, l.text, "auto", undefined, "关闭前保存").catch(() => null);
    await reallyClose();
  }
  /** 不保存：现在的内容先存成版本（找得回来），文件写回上次保存时的样子 */
  async function closeDiscarding() {
    const l = live.current;
    if (be && l.path) {
      await be.saveVersion(l.path, l.text, "auto", undefined, "关闭时没有保存的修改").catch(() => null);
      await be.writeText(l.path, l.base).catch(() => null);
      l.text = l.lastWritten = l.base;
    }
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
  // 文件卡片要用到的操作，经由 ref 调用，免得每次重新渲染都重建编辑器装饰
  const fileHooksRef = useRef<{ open: (abs: string) => void; reveal: (abs: string) => void }>({ open: () => {}, reveal: () => {} });
  fileHooksRef.current = {
    open: (abs) => { if (/\.(md|markdown)$/i.test(abs)) openExternalFile(abs); else be?.openPath(abs).catch(() => say("没能打开这个文件", "error")); },
    reveal: (abs) => { be?.reveal(abs).catch(() => {}); },
  };
  const preview = useMemo(() => ({
    syntax: () => s.syntax,
    citeLabel: (k: string) => { const b = bibMap.get(k); return b ? `${shortAuthor(b.author)}, ${b.year}` : "@" + k; },
    resolveImage: (src: string) => {
      if (/^(https?:|data:)/.test(src)) return src;
      let raw = src.replace(/^<(.*)>$/, "$1");
      try { raw = decodeURI(raw); } catch { /* 原样使用 */ }
      const abs = /^(\/|[A-Za-z]:[\\/])/.test(raw) ? toPosix(raw) : normalize(join(dirOf(live.current.path), raw));
      if (!isTauri && demoImages.has(abs)) return demoImages.get(abs)!;
      if (isTauri) return (window as unknown as { __TAURI_INTERNALS__: { convertFileSrc: (p: string) => string } }).__TAURI_INTERNALS__.convertFileSrc(abs);
      return abs;
    },
    files: {
      resolve: (src: string) => {
        let raw = src.replace(/^<(.*)>$/, "$1");
        try { raw = decodeURI(raw); } catch { /* 原样使用 */ }
        return /^(\/|[A-Za-z]:[\\/])/.test(raw) ? toPosix(raw) : normalize(join(dirOf(live.current.path), raw));
      },
      url: (abs: string) => (isTauri ? (window as unknown as { __TAURI_INTERNALS__: { convertFileSrc: (p: string) => string } }).__TAURI_INTERNALS__.convertFileSrc(abs) : abs),
      preview: (abs: string) => (be ? be.filePreview(abs) : Promise.reject(new Error("no backend"))),
      open: (abs: string) => fileHooksRef.current.open(abs),
      reveal: (abs: string) => fileHooksRef.current.reveal(abs),
    },
    links: {
      docPath: () => live.current.path,
      openUrl: (url: string) => { be?.openUrl(url).catch(() => say("没能打开这个链接", "error")); },
      openFile: (abs: string) => fileHooksRef.current.open(abs),
    },
  }), [s.syntax, bibMap, be]);
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
      setFmt({ active: activeStyles(v.state, r.from, r.to), block: currentBlock(v) });
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
    const inline = { bold: "bold", italic: "italic", strike: "strike", code: "code", math: "math", highlight: "highlight", sup: "sup", sub: "sub" } as const;
    if (id in inline) { if (v) toggleInline(v, inline[id as keyof typeof inline]); return; }
    switch (id) {
      case "settings": setDlg("settings"); break;
      case "new_file": newFile(); break;
      case "open_folder": chooseFolder(); break;
      case "close_folder": closeFolder(); break;
      case "save_version": if (path) setDlg("save"); break;
      case "find": ed.current?.find(); break;
      case "search": setDlg((d) => (d === "palette" ? null : "palette")); break;
      case "link": if (v) insertLink(v); break;
      case "cite": openInsert(); break;
      case "note": if (v && !insertNote(v, AUTHOR)) say("先选中要批注的文字", "warn"); break;
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
      case "export": openExport(); break;
      case "quit": requestClose(); break;
      case "indent": if (v) indentList(v, 1); break;
      case "heading_up": if (v) shiftHeading(v, -1); break;
      case "heading_down": if (v) shiftHeading(v, 1); break;
      case "outdent": if (v) indentList(v, -1); break;
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
    say("批注已解决，文件里的批注标记已移除", "success");
  }
  function applyLayout(l: Record<string, string>) {
    const v = view(); if (!v) return;
    const next = setDocLayout(v.state.doc.toString(), l);
    v.dispatch({ changes: { from: 0, to: v.state.doc.length, insert: next } });
    say(Object.keys(l).some((k) => l[k]) ? "已写入本文属性区" : "已清除本文版式", "success");
  }
  async function saveVersion(name: string, note: string) {
    if (!be || !path) return;
    await flush();
    await be.saveVersion(path, live.current.text, "saved", name, note || undefined);
    live.current.lastVersionAt = Date.now();
    live.current.base = live.current.text;
    setVersions(await be.listVersions(path));
    setDlg(null);
    say(`已保存版本「${name}」`, "success");
  }
  /** against 不给时：默认对比现在；版本和现在一样就改成对比上一版。用户在分段控件里明确选了就照选的来 */
  async function openVersion(id: string, pick?: "current" | "prev") {
    let against = pick ?? "current";
    if (!be) return;
    const i = versions.findIndex((x) => x.id === id);
    const v = versions[i];
    const content = await be.readVersion(path, id);
    if (fresh === id) setFresh(null);
    // 所选版本和现在一模一样（比如最新的那个版本）：对比现在只会是「0 处不同」，自动改成和上一版比
    const same = content === live.current.text;
    if (same && !pick && versions[i + 1]) against = "prev";
    if (against === "prev" && versions[i + 1]) setCmp({ v, against, same, oldText: await be.readVersion(path, versions[i + 1].id), newText: content });
    else setCmp({ v, against: "current", same, oldText: content, newText: live.current.text });
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
    // 直接恢复、不先问“确定吗”，但给几秒撤销：撤销就是把恢复前的内容放回来（它也已经存成了版本）
    const at = path;
    say(`已恢复到「${versionTitle(cmp.v)}」，恢复前的内容已存为版本`, "success", { label: "撤销", run: () => {
      if (live.current.path !== at) return;
      const now = live.current.text;
      ed.current?.replace(before);
      window.setTimeout(() => ed.current?.flash(changedLines(now, before)), 50);
      live.current.text = before;
      setText(before);
      void flush();
    } });
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
        const dest = await be.saveImage(join(dirOf(path), "assets"), name, await toB64(f));
        parts.push(linkFor(dest, path).text);
      } catch (e) { say(`图片保存失败：${e}`, "error"); }
    }
    if (!parts.length) return;
    // 图片自成一段，光标放到图片后面：图片马上按大图显示，点一下就有缩放控制条
    const ins = blockInsertSpec(v.state.doc.toString(), pos, parts.join("\n\n"));
    v.dispatch({ changes: { from: ins.from, insert: ins.insert }, selection: { anchor: ins.cursor }, scrollIntoView: true });
    v.focus();
    say(parts.length > 1 ? `已插入 ${parts.length} 张图片，保存在 assets/` : "图片已保存到 assets/", "success");
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

  async function openExport() {
    if (!path) return;
    await flush().catch(() => null);
    setDlg("export");
  }
  const resolveImage = useCallback((src: string) => preview.resolveImage(src), [preview]);

  /* ---------- 文件管理（右键菜单）---------- */
  const refreshTree = async () => { if (be && root) setTree(await be.listTree(root)); };
  /** 先做后撤销：提示条右边带「撤销」 */
  const undoable = (msg: string, undo: () => Promise<unknown>) => say(msg, "success", { label: "撤销", run: async () => {
    try { await undo(); await refreshTree(); } catch (e) { say(String(e).replace(/^Error:\s*/, ""), "error"); }
  } });
  /** 删除后还没真正移到废纸篓的（提示条消失、或者关窗口时才移） */
  const staged = useRef(new Map<string, number>());
  const commitStaged = (p: string) => { window.clearTimeout(staged.current.get(p)); staged.current.delete(p); be?.commitStaged(p).catch(() => {}); };
  /** 刚新建的文件夹：改完名再提示 */
  const justCreated = useRef("");
  const trashName = isWindows ? "回收站" : "废纸篓";
  /** 改名、移动之后：正在编辑的文件（或它所在的文件夹）跟着换路径 */
  async function followMove(from: string, to: string) {
    const cur = live.current.path;
    if (cur === from || cur.startsWith(from + "/")) {
      const np = to + cur.slice(from.length);
      live.current.path = np;
      setPath(np);
      if (be) setVersions(await be.listVersions(np).catch(() => []));
    }
  }
  async function renameDone(p: string, name: string | null) {
    setRenaming(null);
    if (be && justCreated.current === p && (name === null || name.trim() === baseName(p))) { justCreated.current = ""; newFolderToast(p); return; }
    if (!be || name === null || name.trim() === baseName(p)) return;
    try {
      await flush();
      const to = await be.renamePath(p, name.trim());
      await refreshTree();
      await followMove(p, to);
      if (justCreated.current === p) { justCreated.current = ""; newFolderToast(to); return; }
      undoable(`已改名为「${baseName(to)}」`, async () => { await be.renamePath(to, baseName(p)); await followMove(to, p); });
    } catch (e) { say(String(e).replace(/^Error:\s*/, ""), "error"); }
  }
  const newFolderToast = (p: string) => undoable(`已新建文件夹「${baseName(p)}」`, () => be!.trashPath(p));
  async function moveTo(node: TreeNode, dir: string) {
    if (!be) return;
    try {
      await flush();
      const to = await be.movePath(node.path, dir);
      await refreshTree();
      await followMove(node.path, to);
      const from = dirOf(node.path);
      undoable(`已把「${node.name}」移到「${dir === root ? baseName(root) : relative(root, dir)}」`, async () => { await be.movePath(to, from); await followMove(to, node.path); });
    } catch (e) { say(String(e).replace(/^Error:\s*/, ""), "error"); }
  }
  async function trash(node: TreeNode) {
    if (!be) return;
    try {
      const cur = live.current.path;
      const inside = cur === node.path || cur.startsWith(node.path + "/");
      if (inside) await flush();
      const hold = await be.stageDelete(node.path);
      staged.current.set(hold, window.setTimeout(() => commitStaged(hold), 6500));
      const t = await be.listTree(root);
      setTree(t);
      if (inside) {
        const next = flatten(t).find((f) => /\.(md|markdown)$/i.test(f.name));
        if (next) await openFile(next.path);
        else { live.current = { path: "", text: "", base: "", lastWritten: "", lastVersionAt: 0 }; setPath(""); setText(""); setVersions([]); }
      }
      undoable(`已把「${node.name}」移到${trashName}`, async () => {
        window.clearTimeout(staged.current.get(hold)); staged.current.delete(hold);
        await be.restoreStaged(hold, node.path);
        if (inside) { await refreshTree(); await openFile(cur); }
      });
    } catch (e) { say(String(e).replace(/^Error:\s*/, ""), "error"); }
  }
  async function newFolder(dir: string) {
    if (!be) return;
    const p = await be.createDir(dir, "新建文件夹");
    await refreshTree();
    justCreated.current = p;
    setRenaming(p);
  }
  async function compareWith(p: string) {
    if (!be) return;
    const t = await be.readText(p).catch(() => null);
    if (t === null) { say("读不到这个文件", "error"); return; }
    setCmp(null);
    setFileCmp({ name: root && isInside(root, p) ? relative(root, p) : baseName(p), text: t });
  }
  async function compareOther() {
    if (!be) return;
    if (be.isDemo) { say("浏览器预览里不能选择本机文件"); return; }
    const f = await be.pickFile("选择要对比的文稿", ["md", "markdown", "txt"]);
    if (f) await compareWith(f);
  }
  function treeMenuItems(node: TreeNode | null): MenuEntry[] {
    const reveal = isWindows ? "在资源管理器中显示" : "在访达中显示";
    if (!node) return [
      { label: "新建文稿", icon: "doc", hint: "⌘N", run: () => newFile(root) },
      { label: "新建文件夹", icon: "folder", run: () => newFolder(root) },
      { sep: true },
      { label: reveal, icon: "open", run: () => be?.reveal(root) },
      { label: "刷新", icon: "reset", run: refreshTree },
    ];
    const md = /\.(md|markdown)$/i.test(node.name);
    return [
      ...(node.dir ? [
        { label: "新建文稿", icon: "doc", run: () => newFile(node.path) },
        { label: "新建文件夹", icon: "folder", run: () => newFolder(node.path) },
        { sep: true } as MenuEntry,
      ] : md ? [
        { label: "打开", icon: "doc", run: () => openFile(node.path) },
        ...(node.path !== path && path ? [{ label: "与当前文稿对比", icon: "compare", run: () => compareWith(node.path) }] : []),
        { sep: true } as MenuEntry,
      ] : []),
      { label: "重命名", icon: "edit", run: () => setRenaming(node.path) },
      ...(!node.dir ? [{ label: "创建副本", icon: "copy", run: async () => { if (!be) return; const c = await be.duplicatePath(node.path); await refreshTree(); undoable(`已创建「${baseName(c)}」`, () => be.trashPath(c)); } }] : []),
      { label: "移到…", icon: "folder", run: () => { setMoving(node); setDlg("move"); } },
      { sep: true },
      { label: reveal, icon: "open", run: () => be?.reveal(node.path) },
      { label: "拷贝路径", icon: "link", run: () => { navigator.clipboard?.writeText(node.path).then(() => say("已拷贝路径", "success")).catch(() => {}); } },
      { sep: true },
      { label: `移到${trashName}`, icon: "trash", danger: true, run: () => trash(node) },
    ];
  }
  const folderMenuItems = (): MenuEntry[] => [
    ...(s.recentFolders.filter((f) => f !== root).length ? [{ head: "最近打开" } as MenuEntry, ...s.recentFolders.filter((f) => f !== root).map((f) => ({ label: baseName(f), hint: shortPath(dirOf(f)), icon: "folder", run: () => openFolder(f).catch((e) => say(String(e).includes("重新选择") ? String(e) : "这个文件夹已经不在了", "warn")) }))] : []),
    ...(s.recentFolders.filter((f) => f !== root).length ? [{ sep: true } as MenuEntry] : []),
    { label: "打开其他文件夹…", icon: "folder", hint: "⌘O", run: chooseFolder },
    ...(root ? [{ label: isWindows ? "在资源管理器中显示" : "在访达中显示", icon: "open", run: () => be?.reveal(root) }, { sep: true } as MenuEntry, { label: "关闭文件夹", icon: "close", run: closeFolder }] : []),
  ];
  const folderList = (nodes: TreeNode[]): TreeNode[] => nodes.flatMap((n) => (n.dir ? [n, ...folderList(n.children)] : []));
  const moveItems: PaletteItem[] = moving ? [
    { group: "移到", icon: "folder", title: baseName(root) + "（最外层）", run: () => moveTo(moving, root) },
    ...folderList(tree).filter((d) => d.path !== moving.path && !d.path.startsWith(moving.path + "/") && d.path !== dirOf(moving.path))
      .map((d) => ({ group: "移到", icon: "folder", title: relative(root, d.path), run: () => moveTo(moving, d.path) })),
  ] : [];
  const cmpItems: PaletteItem[] = flatten(tree).filter((f) => /\.(md|markdown)$/i.test(f.name) && f.path !== path)
    .map((f) => ({ group: "文件夹里的文稿", icon: "doc", title: relative(root, f.path), run: () => compareWith(f.path) }));
  const cmpPick: PaletteItem = { group: "其他位置", icon: "folder", title: "选择其他位置的文件…", sub: "用系统的文件选择窗口", run: () => { setTimeout(compareOther, 0); } };
  const noSearch = useCallback(() => [] as PaletteItem[], []);

  /* ---------- search ---------- */
  const folderCache = useRef<Map<string, string>>(new Map());
  useEffect(() => { folderCache.current.clear(); }, [root]);
  const [folderTexts, setFolderTexts] = useState<Map<string, string>>(new Map());
  useEffect(() => {
    if (dlg !== "palette" || !be) return;
    (async () => {
      const files = flatten(tree).filter((f) => isMarkdown(f.name) && f.path !== path);
      for (const f of files) if (!folderCache.current.has(f.path)) folderCache.current.set(f.path, await be.readText(f.path).catch(() => ""));
      setFolderTexts(new Map(folderCache.current));
    })();
  }, [dlg, be, tree, path]);
  /** 搜索结果：选中匹配的文字并滚到屏幕中间 */
  function jumpTo(pos: number, len: number) {
    const v = view(); if (!v) return;
    setCmp(null); setFileCmp(null);
    const at = Math.min(pos, v.state.doc.length);
    v.dispatch({ selection: { anchor: at, head: Math.min(at + len, v.state.doc.length) }, effects: EditorView.scrollIntoView(at, { y: "center" }) });
    v.focus();
  }
  async function openAt(p: string, pos: number, len: number) {
    if (p !== live.current.path) await openFile(p);
    requestAnimationFrame(() => jumpTo(pos, len));
  }

  const commands: PaletteItem[] = [
    { group: "命令", icon: "cmd", title: "保存版本", keys: ["⌘", "S"].map((k) => keyName(k)), run: () => setDlg("save") },
    { group: "命令", icon: "cmd", title: "插入文件链接…", keys: ["⌘", "⇧", "C"].map((k) => keyName(k)), run: () => setTimeout(openInsert, 0) },
    { group: "命令", icon: "cmd", title: "打开文件夹…", keys: ["⌘", "O"].map((k) => keyName(k)), run: chooseFolder },
    ...(root ? [{ group: "命令", icon: "cmd", title: "关闭文件夹", run: closeFolder }] : []),
    { group: "命令", icon: "cmd", title: "新建文稿", keys: ["⌘", "N"].map((k) => keyName(k)), run: newFile },
    { group: "命令", icon: "cmd", title: "与其他文稿对比…", run: () => setTimeout(() => setDlg("cmpfile"), 0) },
    { group: "命令", icon: "cmd", title: "Markdown 语法速查", run: () => setTimeout(() => setDlg("help_syntax"), 0) },
    { group: "命令", icon: "cmd", title: "导出 Word / PDF / Markdown…", keys: ["⌘", "⇧", "E"].map((k) => keyName(k)), run: () => setTimeout(openExport, 0) },
    { group: "命令", icon: "cmd", title: "设置", keys: ["⌘", ","].map((k) => keyName(k)), run: () => setDlg("settings") },
    { group: "命令", icon: "cmd", title: "专注模式", keys: ["⌘", "⇧", "F"].map((k) => keyName(k)), run: () => setFocus((f) => !f) },
    ...hs.filter((h) => h.level >= 2).map((h) => ({ group: "跳转", icon: "go", title: h.text, run: () => jump(h.pos) })),
  ];
  /* ---------- 插入文件链接（⌘⇧C）：光标处的小浮层 ---------- */
  const [insertAt, setInsertAt] = useState<{ left: number; top: number; bottom: number } | null>(null);
  const RECENT_KEY = "holymark-recent-insert";
  const [recentIns, setRecentIns] = useState<string[]>(() => { try { return JSON.parse(localStorage.getItem(RECENT_KEY) || "[]"); } catch { return []; } });
  const rememberInsert = (p: string) => setRecentIns((r) => {
    const n = [p, ...r.filter((x) => x !== p)].slice(0, 12);
    try { localStorage.setItem(RECENT_KEY, JSON.stringify(n)); } catch { /* 存不了就算了 */ }
    return n;
  });
  function openInsert() {
    const v = view(); if (!v || !path) return;
    const c = v.coordsAtPos(v.state.selection.main.head);
    const r = c ?? (() => { const b = v.contentDOM.getBoundingClientRect(); return { left: b.left, top: b.top + 40, bottom: b.top + 60 }; })();
    setInsertAt({ left: Math.round(r.left), top: Math.round(r.top), bottom: Math.round(r.bottom) });
  }
  function pickInsert(p: InsertPick) {
    setInsertAt(null);
    if (p.kind === "bib") { insertAtCursor(`[@${p.key}]`); return; }
    const l = linkFor(p.path, path);
    insertAtCursor(l.text, l.block);
    rememberInsert(p.path);
  }
  /* ---------- 从访达 / 资源管理器拖文件进来 ---------- */
  const [dropCaret, setDropCaret] = useState<{ left: number; top: number; height: number } | null>(null);
  const overEditor = (x: number, y: number) => {
    const r = scroller.current?.getBoundingClientRect();
    return !!path && !!r && x >= r.left && x <= r.right && y >= r.top && y <= r.bottom;
  };
  /** 拖着移动时：正文里显示一条竖线，标出松手后插在哪里 */
  function dragOver(x: number, y: number) {
    const v = view();
    if (!v || !overEditor(x, y)) { setDropCaret(null); return; }
    const pos = v.posAtCoords({ x, y }) ?? v.state.selection.main.head;
    const c = v.coordsAtPos(pos);
    setDropCaret(c ? { left: Math.round(c.left), top: Math.round(c.top), height: Math.round(c.bottom - c.top) } : null);
  }
  /**
   * 松手：拖进正文的，图片插成插图（文件夹以外的先复制进本文旁边的 assets/），其他文件插成相对路径链接；
   * 拖到正文以外的地方，有 Markdown 文件就打开它。
   */
  async function dropFiles(paths: string[], x: number, y: number) {
    setDropCaret(null);
    const v = view();
    if (!be || !paths.length) return;
    if (!v || !overEditor(x, y)) {
      const md = paths.find((p) => /\.(md|markdown)$/i.test(p));
      if (md) await openExternalFile(md); else if (path) say("拖到正文里松手，就会插入文件链接");
      return;
    }
    const pos = v.posAtCoords({ x, y }) ?? v.state.selection.main.head;
    const imgs: string[] = [], links: string[] = [];
    let copied = 0;
    for (const p of paths) {
      if (/\.(png|jpe?g|gif|webp|svg|bmp)$/i.test(p)) {
        let src = p;
        if (!(root && isInside(root, p))) {
          try { src = await be.copyIntoFolder(p, join(dirOf(path), "assets")); copied++; } catch (e) { say(`图片复制失败：${e}`, "error"); continue; }
        }
        imgs.push(linkFor(src, path).text);
      } else {
        // PDF、Word 这些单独成段（显示成预览卡片），其余插成行内链接
        const l = linkFor(p, path);
        (l.block ? imgs : links).push(l.text);
        rememberInsert(p);
      }
    }
    if (imgs.length) {
      const ins = blockInsertSpec(v.state.doc.toString(), pos, [...(links.length ? [links.join("　")] : []), ...imgs].join("\n\n"));
      v.dispatch({ changes: { from: ins.from, insert: ins.insert }, selection: { anchor: ins.cursor }, scrollIntoView: true });
    } else if (links.length) {
      const t = links.join("　");
      v.dispatch({ changes: { from: pos, insert: t }, selection: { anchor: pos + t.length }, scrollIntoView: true });
    }
    v.focus();
    const n = imgs.length + links.length;
    if (n) say(copied ? `已插入 ${n} 个文件，其中 ${copied} 张图片复制到了 assets/` : imgs.length && !links.length ? `已插入 ${imgs.length} 张图片` : `已插入 ${n} 个文件链接`, "success");
  }
  const dropRef = useRef({ dragOver, dropFiles });
  dropRef.current = { dragOver, dropFiles };
  useEffect(() => {
    if (!be) return;
    let frame = 0;
    return be.onFileDrop((e) => {
      cancelAnimationFrame(frame);
      if (e.type === "over") frame = requestAnimationFrame(() => dropRef.current.dragOver(e.x, e.y));
      else if (e.type === "drop") dropRef.current.dropFiles(e.paths, e.x, e.y);
      else setDropCaret(null);
    });
  }, [be]);

  /** 引用文件夹以外的文件：用系统的文件选择窗口，插入相对路径链接 */
  async function citeOtherFile() {
    if (!be || !path) return;
    if (be.isDemo) { say("浏览器预览里不能选择本机文件"); return; }
    const f = await be.pickFile("选择要插入链接的文件");
    if (f) { const l = linkFor(f, path); insertAtCursor(l.text, l.block); }
  }

  /* ---------- keyboard ---------- */
  // 没有原生菜单时（Windows、浏览器预览），菜单里的快捷键都在这里处理；
  // macOS 上原生菜单先接住这些按键，这里只兜底几个常用的
  const APP_LEVEL = useMemo(() => new Set(["search", "save_version", "export", "settings", "focus", "toggle_side", "toggle_panel", "toggle_ribbon", "new_file", "open_folder", "panel_outline", "panel_notes", "panel_versions"]), []);
  const MAC_FALLBACK = useMemo(() => new Set(["search", "save_version", "settings", "focus", "toggle_side", "toggle_panel", "new_file", "open_folder"]), []);
  useEffect(() => {
    const f = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !dlg) { if (cmp || fileCmp) { setCmp(null); setFileCmp(null); } else if (focus) setFocus(false); return; }
      if (e.defaultPrevented || e.isComposing) return; // 编辑器自己处理过的（如 ⌘B），或正在用输入法
      const id = menuIdFor(e);
      if (!id || (nativeMenu && !MAC_FALLBACK.has(id))) return;
      // 焦点在输入框、表格单元格里时，格式和插入类的快捷键不作用到正文
      const ae = document.activeElement as HTMLElement | null;
      const inField = !!ae && (ae.tagName === "INPUT" || ae.tagName === "TEXTAREA" || (ae.isContentEditable && !ae.classList.contains("cm-content")));
      if (inField && !APP_LEVEL.has(id)) return;
      e.preventDefault();
      onMenu(id);
    };
    addEventListener("keydown", f);
    return () => removeEventListener("keydown", f);
  });

  const changesSinceLast = useMemo(() => 0, []);
  const [lastVersionText, setLastVersionText] = useState("");
  useEffect(() => { if (dlg === "save" && be && versions[0]) be.readVersion(path, versions[0].id).then(setLastVersionText); }, [dlg, be, versions, path]);
  const saveChanges = useMemo(() => (dlg === "save" ? alignBlocks(lastVersionText, text).filter((r) => r.ops).length : changesSinceLast), [dlg, lastVersionText, text, changesSinceLast]);

  /** 状态栏的字数：点一下打开浮窗，再点一下关上 */
  function toggleCount(title: string, t: string, el: HTMLElement) {
    setCountPop((p) => (p?.title === title ? null : { title, text: t, rect: el.getBoundingClientRect() }));
  }
  const dirty = !!path && text !== live.current.base;

  const appCls = [s.eqNumbers ? "eqnum" : "", "app", showSide ? "" : "no-side", showPanel ? "" : "no-panel", focus ? "focus" : "", isTauri && isMac ? "mac" : "", customFrame ? "framed" : ""].join(" ");
  const fileName = baseName(path);
  const crumbs = path && root ? relative(root, path).split("/") : [];

  return (
    <div className={appCls} style={editorStyle}>
      <header className="titlebar" data-tauri-drag-region>
        <button className="ib" title={kbd("切换侧栏 ⌘\\")} aria-label="切换侧栏" onClick={() => setShowSide(!showSide)}><Icon name="side" /></button>
        <div className="crumbs" data-tauri-drag-region>
          {root && <span>{baseName(root)}</span>}
          {crumbs.map((c, i) => <span key={i} className="crumb"><span className="sep">/</span>{i === crumbs.length - 1 ? <b>{c}</b> : c}</span>)}
          {dirty && <span className="dirty" title={kbd("这次打开后有修改（已自动写入文件）。按 ⌘S 保存版本，关闭时也会询问")} aria-label="有修改" />}
        </div>
        <div className="spacer" data-tauri-drag-region />
        {path && saveState === "error" && <div className="savestate" role="alert" title="自动保存没有成功，继续编辑会再次尝试"><i />保存失败</div>}
        <button className="searchbtn" onClick={() => setDlg("palette")} aria-label="搜索或执行命令"><Icon name="search" size={14} /><span className="lbl">搜索</span><kbd>{kbd("⌘K")}</kbd></button>
        <button className={"ib" + (focus ? " on" : "")} title={kbd("专注 ⌘⇧F")} aria-label="专注模式" onClick={() => setFocus(!focus)}><Icon name="focus" /></button>
        <button className="ib" title={kbd("导出 ⌘⇧E")} aria-label="导出" disabled={!path} onClick={openExport}><Icon name="export" /></button>
        <button className="ib" title={kbd("切换右栏 ⌘/")} aria-label="切换右栏" onClick={() => setShowPanel(!showPanel)}><Icon name="panel" /></button>
        {customFrame && <WindowControls />}
      </header>

      <aside className="side" aria-label="文件夹">
        <div className="side-in">
          <div className="side-scroll">
            <button className={"folder" + (root ? "" : " none")} onClick={(e) => { if (!root) { chooseFolder(); return; } const r = e.currentTarget.getBoundingClientRect(); setFolderMenu({ x: r.left + 8, y: r.bottom }); }} title={root ? root : "选择一个放稿件的文件夹"} aria-haspopup="menu">
              <span className="fname">{root ? baseName(root) : "打开文件夹"}</span>
              <span className="fpath">{root ? shortPath(root) : "选择一个放稿件的文件夹"}</span>
            </button>
            <FileTree nodes={tree} current={path} onOpen={openFile} showAll={s.showAllFiles} renaming={renaming} onRename={renameDone}
              onMenu={(e, node) => { if (root) setTreeMenu({ x: e.clientX, y: e.clientY, node }); }} />
          </div>
          {/* Mac 上设置在菜单栏「HolyMark → 设置…」里，左下角不再放 */}
          {!nativeMenu && <div className="side-foot"><button className="tn" onClick={() => setDlg("settings")}><span className="ico"><Icon name="gear" size={14} /></span><span className="nm">设置</span><span className="ext">{kbd("⌘,")}</span></button></div>}
        </div>
      </aside>

      <main className="main">
        {path && <Ribbon view={ed.current?.view() ?? null} author={AUTHOR} settings={s} fonts={fonts} layout={layout} onLayout={applyLayout}
          collapsed={s.ribbonCollapsed} setCollapsed={(c) => update({ ribbonCollapsed: c })}
          onPickImage={pickImage} onCite={openInsert} active={fmt.active} block={fmt.block} />}
        <div className="scroller" ref={scroller} onScroll={() => window.requestAnimationFrame(syncScrollHeading)} onMouseDown={clickBelow}>
          <div className="doc">
            {!path && <Welcome hasRoot={!!root} recent={s.recentFolders} onOpen={chooseFolder} onNew={() => newFile()} onRecent={(f) => openFolder(f).catch((e) => { if (String(e).includes("重新选择")) { say(String(e), "warn"); return; } say("这个文件夹已经不在了", "warn"); update({ recentFolders: s.recentFolders.filter((x) => x !== f) }); })} />}
            <div hidden={!path}><Editor ref={ed} initial="" preview={preview} previewKey={previewKey} onChange={onChange} onSelection={onSelection} onImages={insertImages} /></div>
          </div>
        </div>
        <FloatingToolbar view={ed.current?.view() ?? null} tick={tick} author={AUTHOR} active={fmt.active} />
        {fileCmp && <Compare fileLabel={fileCmp.name} oldText={fileCmp.text} newText={live.current.text} against="current" hasPrev={false} prevLabel=""
          onAgainst={() => {}} onClose={() => setFileCmp(null)} onRestore={() => {}} onPick={() => setDlg("cmpfile")} />}
        {cmp && (
          <Compare version={cmp.v} oldText={cmp.oldText} newText={cmp.newText} against={cmp.against} sameAsNow={cmp.same}
            hasPrev={versions.findIndex((x) => x.id === cmp.v.id) < versions.length - 1}
            prevLabel={(() => { const p = versions[versions.findIndex((x) => x.id === cmp.v.id) + 1]; if (!p) return ""; const t = fmtTime(p.at); return `${versionTitle(p)} · ${t.day} ${t.hm}`; })()}
            onAgainst={(a) => openVersion(cmp.v.id, a)} onClose={() => setCmp(null)} onRestore={restore} />
        )}
      </main>

      <aside className="panel" aria-label="当前文件">
        <SidePanel tab={tab} setTab={setTab} headings={hs} currentHeading={currentHeading} notes={notes} versions={versions} freshVersion={fresh}
          selectedVersion={cmp?.v.id ?? null} fileName={fileName} onJump={jump} onResolve={resolveNote}
          onOpenVersion={(id) => openVersion(id)} onSaveVersion={() => setDlg("save")} onCompareFile={() => setDlg("cmpfile")} />
      </aside>

      <footer className="statusbar">
        <span className="sb">本节 <b>{stats.sec.toLocaleString()}</b></span>
        <button className={"sb" + (countPop?.title === "全文" ? " on" : "")} data-countpop aria-expanded={countPop?.title === "全文"} onClick={(e) => toggleCount("全文", plainText(text), e.currentTarget)}>全文 <b>{stats.total.toLocaleString()}</b></button>
        {selText && <button className={"sb sel" + (countPop?.title === "选中的文字" ? " on" : "")} data-countpop aria-expanded={countPop?.title === "选中的文字"} onMouseDown={(e) => e.preventDefault()} onClick={(e) => toggleCount("选中的文字", plainText(selText), e.currentTarget)}>选中 <b>{countWords(plainText(selText), s.countPunct).toLocaleString()}</b></button>}
        {s.goalOn && <div className="r"><div className="goalbar"><i style={{ width: `${Math.min(100, (stats.total / s.goal) * 100)}%` }} /></div><span className="sb"><b>{stats.total.toLocaleString()} / {s.goal.toLocaleString()}</b></span></div>}
        {be?.isDemo && <span className="sb demo-tag">浏览器预览 · 演示文件夹</span>}
      </footer>

      <Presence>{countPop && <CountPop title={countPop.title} text={countPop.text} count={count} anchor={countPop.rect} onClose={() => setCountPop(null)} />}</Presence>
      <Presence>{dlg === "save" && <SaveVersionDialog changes={saveChanges} fileName={fileName} onSave={saveVersion} onClose={() => setDlg(null)} />}</Presence>
      <Presence>{dlg === "settings" && <SettingsDialog s={s} fonts={fonts} onChange={update} onClose={() => setDlg(null)} />}</Presence>
      <Presence>{(dlg === "help_syntax" || dlg === "help_keys") && <HelpDialog kind={dlg === "help_syntax" ? "syntax" : "keys"} onClose={() => setDlg(null)} />}</Presence>
      <Presence>{dlg === "palette" && <SearchPanel text={live.current.text} path={path} root={root} headings={hs} folderTexts={folderTexts} commands={commands}
        onJump={jumpTo} onOpenAt={openAt} onClose={() => setDlg(null)} />}</Presence>
      <Presence ms={100}>{insertAt && <InsertFile at={insertAt} files={flatten(tree)} docPath={path} root={root} bib={bib} recent={recentIns}
        onPick={pickInsert} onPickOther={() => { setInsertAt(null); setTimeout(citeOtherFile, 0); }} onClose={() => { setInsertAt(null); view()?.focus(); }} />}</Presence>
      <Presence>{dlg === "export" && be && <ExportDialog be={be} path={path} root={root} text={text} tree={tree} bib={bib} fonts={fonts} resolveImage={resolveImage} onClose={() => setDlg(null)} />}</Presence>
      <Presence>{dlg === "cmpfile" && <Palette items={cmpItems} search={noSearch} pinned={cmpPick} onClose={() => setDlg(null)} placeholder="选一篇文稿，和当前文稿左右对比" />}</Presence>
      <Presence>{dlg === "move" && moving && <Palette items={moveItems} search={noSearch} onClose={() => { setDlg(null); setMoving(null); }} placeholder={`把「${moving.name}」移到哪个文件夹`} />}</Presence>
      {treeMenu && <Menu x={treeMenu.x} y={treeMenu.y} items={treeMenuItems(treeMenu.node)} onClose={() => setTreeMenu(null)} />}
      {folderMenu && <Menu x={folderMenu.x} y={folderMenu.y} items={folderMenuItems()} onClose={() => setFolderMenu(null)} minWidth={232} />}
      <Presence>{dlg === "unsaved" && <UnsavedDialog fileName={fileName} onSave={closeSaving} onDiscard={closeDiscarding} onCancel={() => setDlg(null)} />}</Presence>
      {dropCaret && <div className="dropcaret" style={{ left: dropCaret.left, top: dropCaret.top, height: dropCaret.height }} aria-hidden="true" />}
      <Presence>{toast && <div className={"toast " + toast.kind} role="status">{toast.kind !== "info" && <i aria-hidden="true" />}{toast.msg}{toast.action && <button className="lnk" onClick={() => { toast.action!.run(); setToast(null); }}>{toast.action.label}</button>}</div>}</Presence>
    </div>
  );
}
