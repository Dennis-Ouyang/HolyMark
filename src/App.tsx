import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { EditorView } from "@codemirror/view";
import { Editor, EditorHandle } from "./editor/Editor";
import { Backend, demoImages, demoStartFile, FontFamily, getBackend, isTauri, TreeNode, VersionMeta } from "./lib/backend";
import { alignBlocks, changedLines, countWords, docLayout, headings, Note, parseNotes, plainText, setDocLayout, wordCounter } from "./lib/markdown";
import { applyAccent, DEFAULTS, loadSettings, saveSettings, Settings, fontStack } from "./lib/settings";
import { BibEntry, citeOne, citeText, parseBib } from "./lib/bib";
import { FileTree } from "./components/FileTree";
import { FloatingToolbar, Ribbon } from "./components/Toolbars";
import { activeStyles, BlockKind, blockInsertSpec, currentBlock, indentList, InlineKind, shiftHeading, insertBlock, insertLink, insertNote, setBlock, tableMarkdown, toggleInline } from "./editor/commands";
import { PanelTab, SidePanel, fmtTime, versionTitle } from "./components/SidePanel";
import { Compare } from "./components/Compare";
import { CountPop, HelpDialog, Palette, PaletteItem, SaveVersionDialog, SettingsDialog } from "./components/Dialogs";
import { Icon } from "./components/Icons";
import { Presence } from "./components/Presence";
import { WindowControls } from "./components/WindowControls";
import { Menu, MenuEntry } from "./components/Menu";
import { SearchPanel } from "./components/Search";
import { InsertFile, InsertPick, linkFor } from "./components/InsertFile";
import { baseName, dirOf, isInside, isMarkdown, join, normalize, relative, stripMd, toPosix } from "./lib/paths";
import { MidName } from "./components/MidName";
import { TooltipLayer } from "./components/Tooltip";
import { sortTree } from "./lib/sortTree";
import { isMac, isWindows, kbd } from "./lib/platform";
import { menuIdFor } from "./lib/shortcuts";
import { accelOf, COMMANDS, customShortcuts, keyCaps, loadShortcuts, menuSpec, onShortcutsChange, shortcutOf, tipOf } from "./lib/commandRegistry";
import { ExportDialog } from "./components/ExportDialog";
import type { Pane } from "./components/Dialogs";
import { features, FeatureHooks } from "./editor/features";
import { useTidy } from "./features/useTidy";
import { useWritingStats } from "./features/useWritingStats";
import { useSymbols } from "./features/useSymbols";
import { foldHeadings, foldToLevel, unfoldAll } from "./editor/sectionFold";
import { useReading } from "./features/useReading";
import { useRememberSpot, useSpotAutosave } from "./features/useRememberSpot";
import { useNav } from "./features/useNav";
import { FileInfo, FileViewer } from "./components/FileViewer";
import type { FilePreview } from "./lib/filePreview";
import { copyRich } from "./features/copyRich";
import { addDoiEntry, doiTargets } from "./features/useDoi";
import { FolderReplace, ReplaceItem } from "./components/FolderReplace";
import { ChangeSet } from "@codemirror/state";
import { findAnchor } from "./lib/anchors";
import { LinkHooks, openLink } from "./editor/links";
import { moveSection } from "./editor/blockMoves";
import { useTreeOrder } from "./features/useTreeOrder";
import { alignWithRanges, removeRow, restoreRow } from "./lib/restoreBlock";
import { merge3 } from "./lib/merge";
import { noteAuthor, setNoteAuthor } from "./editor/notes";
import { NoticeAction, NoticeKind, setNotifier } from "./editor/notice";

/** ⌘K 里命令的小图标（没写的用通用图标） */
const COMMAND_ICON: Record<string, string> = {
  reading: "book", nav_back: "left", nav_forward: "right", fold_all: "chevRight", unfold_all: "chev", fold_h2: "chevRight",
  folder_replace: "replace", tidy: "typography", math_symbols: "symbols", copy_rich: "clip", copy_wechat: "clip",
  typewriter: "typewriter", para_focus: "parafocus", paper_default: "paper", paper_cream: "paper", paper_gray: "paper", close_preview: "doc",
};
/** macOS 有原生菜单负责快捷键；Windows 和浏览器预览里由前端处理 */
const nativeMenu = isTauri && isMac;
/** Windows 上不用系统标题栏，窗口按钮自己画 */
const customFrame = isTauri && isWindows;
/** 后端报错里给人看的那句话（比如「为了安全，HolyMark 不直接打开程序和脚本……」）；不是给人看的就用 fallback */
function reason(e: unknown, fallback: string) {
  const m = String((e as Error)?.message ?? e ?? "").replace(/^Error:\s*/, "").trim();
  return /[\u4e00-\u9fff]/.test(m) ? m : fallback;
}
function flatten(nodes: TreeNode[]): TreeNode[] { return nodes.flatMap((n) => (n.dir ? flatten(n.children) : [n])); }
/** 连文件夹一起摊平 */
function flatten2(nodes: TreeNode[]): TreeNode[] { return nodes.flatMap((n) => (n.dir ? [n, ...flatten2(n.children)] : [n])); }
/** 侧栏里显示的路径：太长时只留后半段 */
function shortPath(p: string) { return p.length > 38 ? "…" + p.slice(-37) : p; }

/**
 * 侧栏宽度的拖拽线（H9）：拖的时候直接改 CSS 变量（不重画整个应用），松手后记进设置；双击恢复默认宽度。
 */
function Resizer({ side, value, min, max, def, onChange }: { side: "left" | "right"; value: number; min: number; max: number; def: number; onChange: (w: number) => void }) {
  const down = (e: React.MouseEvent) => {
    if (e.button !== 0) return;
    e.preventDefault();
    const app = (e.currentTarget as HTMLElement).closest<HTMLElement>(".app")!;
    const x0 = e.clientX;
    let w = value;
    app.classList.add("resizing");
    const move = (ev: MouseEvent) => {
      w = Math.round(Math.max(min, Math.min(max, value + (side === "left" ? ev.clientX - x0 : x0 - ev.clientX))));
      app.style.setProperty(side === "left" ? "--sw0" : "--pw0", w + "px");
    };
    const up = () => { removeEventListener("mousemove", move); removeEventListener("mouseup", up); app.classList.remove("resizing"); onChange(w); };
    addEventListener("mousemove", move);
    addEventListener("mouseup", up);
  };
  return <div className={"resizer " + side} role="separator" aria-orientation="vertical" aria-label="拖动调整宽度，双击恢复默认" title="拖动调整宽度，双击恢复默认"
    onMouseDown={down} onDoubleClick={() => onChange(def)} />;
}

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
  /** 窄于 1100 时两侧栏变成浮在正文上的抽屉（G4）：drawer 是现在拉出来的那一个 */
  const [narrow, setNarrow] = useState(() => matchMedia("(max-width: 1100px)").matches);
  const [drawer, setDrawer] = useState<null | "side" | "panel">(null);
  useEffect(() => {
    const mq = matchMedia("(max-width: 1100px)");
    const f = () => { setNarrow(mq.matches); setDrawer(null); };
    mq.addEventListener("change", f);
    return () => mq.removeEventListener("change", f);
  }, []);
  const toggleSide = () => (narrow ? setDrawer((d) => (d === "side" ? null : "side")) : setShowSide((x) => !x));
  const togglePanel = () => (narrow ? setDrawer((d) => (d === "panel" ? null : "panel")) : setShowPanel((x) => !x));
  const openPanel = () => (narrow ? setDrawer("panel") : setShowPanel(true));
  const [focus, setFocus] = useState(false);
  const [dlg, setDlg] = useState<null | "save" | "settings" | "palette" | "help_syntax" | "help_keys" | "export" | "cmpfile" | "move" | "replace">(null);
  /** 文件夹替换（N9）打开时带着的查找文字 */
  const [replaceQ, setReplaceQ] = useState("");
  const [fonts, setFonts] = useState<FontFamily[]>([]);
  /** 设置打开时先显示哪一页 */
  const [settingsPane, setSettingsPane] = useState<Pane | undefined>(undefined);
  const [scrollHeading, setScrollHeading] = useState(0);
  const scroller = useRef<HTMLDivElement>(null);
  const [tick, setTick] = useState(0);
  const [selText, setSelText] = useState("");
  /** 光标处的行内格式和段落类型，工具栏按钮显示按下状态 */
  const [fmt, setFmt] = useState<{ active: Set<InlineKind>; block: BlockKind }>({ active: new Set(), block: "p" });
  const [cursor, setCursor] = useState(0);
  const [bib, setBib] = useState<BibEntry[]>([]);
  const [countPop, setCountPop] = useState<{ title: string; text: string; rect: DOMRect } | null>(null);
  const [toast, setToast] = useState<{ msg: string; kind: NoticeKind; actions: NoticeAction[] } | null>(null);
  const ed = useRef<EditorHandle>(null);
  // base：上一次“保存”时的内容（打开文件、保存版本、外部修改之后）。和 text 不同就是有没保存的修改，关闭应用时会问
  // opened：这次打开时的内容（「撤销这次打开以来的修改」回到这里）
  // needBase：打开后还没存过起点版本。打开时不写盘，第一次真正改动前才存（只看不改的文件夹里不会出现 .holymark/）
  const live = useRef<{ path: string; text: string; base: string; opened: string; lastWritten: string; lastVersionAt: number; needBase?: boolean }>({ path: "", text: "", base: "", opened: "", lastWritten: "", lastVersionAt: 0 });
  /** 单独打开的文件（不在工作区里）：只有这一个文件，不扫描它所在的文件夹 */
  const [single, setSingle] = useState("");
  /** 正文区正在预览的非 Markdown 文件（N5）；编辑器一直挂着，切回去照旧 */
  const [viewing, setViewing] = useState("");
  const [viewInfo, setViewInfo] = useState<FilePreview | null>(null);
  /** 文件树单击：Markdown 打开编辑，其他文件在正文区预览 */
  const openFromTree = (p: string) => {
    if (!/\.(md|markdown)$/i.test(p)) { setViewing(p); return; }
    if (p === live.current.path) { setViewing(""); return; }
    void openFile(p);
  };
  const saveTimer = useRef<number>();

  const view = (): EditorView | null => ed.current?.view() ?? null;
  /** 新功能的编辑器扩展（features.ts）：只建一次，回调经由 featureHooks 换成最新的 */
  const featureHooks = useRef<FeatureHooks>({});
  featureHooks.current.env = { typewriter: () => sRef.current.typewriter, paraFocus: () => sRef.current.paraFocus };
  featureHooks.current.slash = { run: (id) => menuRef.current(id) };
  const extra = useMemo(() => features(featureHooks), []);
  // 方便自动化测试读取编辑器状态
  (window as unknown as { __hm: unknown }).__hm = { view, menu: (id: string) => menuRef.current(id), openExternal: (p: string) => openExternalFile(p) };
  /** 提示条。kind 决定前面小圆点的颜色：success 绿、warn 琥珀、error 红，info 不带点；第二个参数也可以直接给操作（普通提示） */
  const say = useCallback((m: string, kind: NoticeKind | NoticeAction | NoticeAction[] = "info", action?: NoticeAction | NoticeAction[]) => {
    if (typeof kind !== "string") { action = kind; kind = "info"; }
    const actions = !action ? [] : Array.isArray(action) ? action : [action];
    setToast({ msg: m, kind, actions });
    window.clearTimeout((say as unknown as { t: number }).t);
    (say as unknown as { t: number }).t = window.setTimeout(() => setToast(null), actions.length ? 6000 : 2600);
  }, []);

  useEffect(() => { setNotifier(say); }, [say]);
  // 批注署名：设置里填的；第一次启动时还空着，用系统用户名填上（浏览器预览里拿不到，留空，显示成「我」）
  setNoteAuthor(s.noteAuthor);
  useEffect(() => {
    if (!be || s.noteAuthor) return;
    be.userName().then((n) => { if (n) update({ noteAuthor: n }); }).catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [be]);

  // 对话框（搜索、导出、设置……）关掉后，把焦点和原来的光标位置还给正文（H16）；
  // 光标位置 CodeMirror 自己记着，这里只把焦点还回去
  const prevDlg = useRef<typeof dlg>(null);
  useEffect(() => {
    const was = prevDlg.current;
    prevDlg.current = dlg;
    // 正在退场的对话框（.leaving 里）不算
    if (was && !dlg && path) requestAnimationFrame(() => { if (![...document.querySelectorAll(".scrim, .menu, .ins")].some((e) => !e.closest(".leaving"))) view()?.focus(); });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dlg]);

  /* ---------- settings & theme ---------- */
  const sRef = useRef(s);
  sRef.current = s;
  // 打字机滚动、段落聚焦开关变了：让编辑器马上重算一次
  useEffect(() => { view()?.dispatch({}); }, [s.paraFocus, s.typewriter]); // eslint-disable-line react-hooks/exhaustive-deps
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
    setSingle("");
    setRoot(dir); setTree(sortTree(t)); update({ lastFolder: dir, recentFolders: [dir, ...s.recentFolders.filter((x) => x !== dir)].slice(0, 8) });
    const files = flatten(t);
    const bibs = files.filter((f) => f.name.endsWith(".bib"));
    const entries = (await Promise.all(bibs.map((b) => be.readText(b.path).catch(() => "")))).flatMap(parseBib);
    setBib(entries);
    const first = file || files.find((f) => isMarkdown(f.name))?.path;
    if (first) await openFile(first);
  }
  /**
   * 从访达或资源管理器打开的文件：在当前工作区里就直接打开，否则只打开这一个文件（不动它所在的文件夹）。
   * fromLink：文稿里链接指向工作区以外的 .md。后端只让单独打开系统交来的、或用户亲自选的文件，
   * 所以这种被拒绝时交给默认程序打开（默认程序是 HolyMark 时，系统会把它再交回来）
   */
  async function openExternalFile(p: string, fromLink = false) {
    if (root && isInside(root, p)) await openFile(p);
    else if (!(await openSingle(p, fromLink)) && fromLink) openOther(p);
  }
  async function openSingle(p: string, quiet = false): Promise<boolean> {
    if (!be) return false;
    if (live.current.path) spots.capture(live.current.path);
    await flush().catch(() => {});
    try { await be.openSingle(p); } catch (e) { if (!quiet) say(reason(e, "没能打开这个文件"), "warn"); return false; }
    setRoot(""); setSingle(p); setBib([]); setCmp(null); setFileCmp(null);
    setTree([{ name: baseName(p), path: p, dir: false, children: [] }]);
    await openFile(p, { readingDefault: s.externalReading });
    return true;
  }
  /** 「打开所在文件夹」：把它所在的文件夹当工作区打开，之前的版本搬进那个工作区的 .holymark/ */
  async function adoptSingleFolder() {
    if (!be || !single) return;
    const p = single, dir = dirOf(p);
    await flush().catch(() => {});
    const n = await be.adoptSingle(p, dir).catch(() => 0);
    await openFolder(dir, p);
    if (n) say(`已把这篇的 ${n} 个版本带进「${baseName(dir)}」`);
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
    const p = await be.createFile(dir ?? (path && s.newDocPlace !== "root" ? dirOf(path) : root), "未命名");
    setTree(sortTree(await be.listTree(root)));
    await openFile(p);
    autoName.current.add(p); saveAutoName();
    undoable(`已新建「${baseName(p)}」`, async () => { await be.trashPath(p); if (prev) await openFile(prev); });
    // 光标放在标题里、选中「未命名」，直接打字就替换掉（F13）
    const v = view();
    if (v) {
      v.focus();
      const m = v.state.doc.line(1).text.match(/^#\s+(.*)$/);
      if (m) v.dispatch({ selection: { anchor: v.state.doc.line(1).from + m[0].length - m[1].length, head: v.state.doc.line(1).to } });
      else v.dispatch({ selection: { anchor: v.state.doc.length } });
    }
  }

  /**
   * 新建的文稿在用户手动改名之前，文件名跟着第一个标题走（F13）：标题停止改动 1.2 秒后改文件名，
   * 不弹提示、不进撤销。手动改过名（或移动过）就不再跟。名单记在本机。
   */
  const autoName = useRef<Set<string>>(new Set((() => { try { return JSON.parse(localStorage.getItem("hm-autoname") || "[]"); } catch { return []; } })()));
  const saveAutoName = () => { try { localStorage.setItem("hm-autoname", JSON.stringify([...autoName.current].slice(-50))); } catch { /* 存不了就算了 */ } };
  const autoTimer = useRef(0);
  useEffect(() => {
    if (!be || !path || !autoName.current.has(path)) return;
    const h = headings(text)[0];
    const want = (h?.text || "").replace(/[\\/:*?"<>|\n]/g, "").replace(/^\.+/, "").trim().slice(0, 60);
    const ext = path.match(/\.[^./]+$/)?.[0] || ".md";
    if (!want || want === baseName(path).slice(0, -ext.length)) return;
    window.clearTimeout(autoTimer.current);
    autoTimer.current = window.setTimeout(async () => {
      const from = live.current.path;
      if (from !== path || !autoName.current.has(from)) return;
      await flush().catch(() => {});
      for (let n = 1; n < 20; n++) {
        try {
          const to = await be.renamePath(from, (n === 1 ? want : `${want} ${n}`) + ext);
          autoName.current.delete(from); autoName.current.add(to); saveAutoName();
          await refreshTree();
          await followMove(from, to);
          return;
        } catch (e) { if (!/已经有/.test(String(e))) return; }
      }
    }, 1200);
    return () => window.clearTimeout(autoTimer.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [text, path, be]);
  /**
   * 批量导出一个文件夹（G3）：文件夹里（含子文件夹）的所有文稿按文件树的顺序，导出对话框里选「合并成一个文件」或「分别导出」
   */
  const [batch, setBatch] = useState<{ name: string; dir: string; files: { path: string; text: string }[] } | null>(null);
  async function exportFolder(node: TreeNode) {
    if (!be) return;
    await flush().catch(() => {});
    // 合并的顺序和文件树一样（手动排序时按 .holymark/order.json，N18）
    const shownNode = flatten2(treeOrder.shown).find((n) => n.path === node.path) ?? sortTree([node])[0];
    const mds = flatten(shownNode.children).filter((f) => isMarkdown(f.name));
    if (!mds.length) { say("这个文件夹里没有文稿", "info"); return; }
    const files = await Promise.all(mds.map(async (f) => ({ path: f.path, text: f.path === live.current.path ? live.current.text : await be.readText(f.path).catch(() => "") })));
    setBatch({ name: node.name, dir: node.path, files });
    setDlg("export");
  }
  /** 从 Word 导入（G9）：选一个 .docx，用内置 Pandoc 转成文稿旁边的 .md，图片放进图片文件夹，然后打开 */
  async function importDocx() {
    if (!be || !root) { await chooseFolder(); return; }
    if (be.isDemo) { say("浏览器预览里不能从 Word 导入", "info"); return; }
    const src = await be.pickFile("选择要导入的 Word 文件", ["docx"]);
    if (!src) return;
    try {
      const p = await be.importDocx(src, path && s.newDocPlace !== "root" ? dirOf(path) : root, s.imageDir || "assets");
      await refreshTree();
      await openFile(p);
      undoable(`已从 Word 导入「${baseName(p)}」`, async () => { await be.trashPath(p); });
    } catch (e) { say(String(e).replace(/^Error:\s*/, ""), "error"); }
  }
  /** 关闭文件夹，回到开始页；下次启动也从开始页开始，直到再打开一个文件夹 */
  async function closeFolder() {
    if (!be || (!root && !single)) return;
    setSingle("");
    spots.capture(live.current.path);
    await flush().catch(() => {});
    await Promise.all([...staged.current.keys()].map((p) => { window.clearTimeout(staged.current.get(p)); return be.commitStaged(p).catch(() => {}); }));
    staged.current.clear();
    await be.closeFolder().catch(() => {});
    live.current = { path: "", text: "", base: "", opened: "", lastWritten: "", lastVersionAt: 0 };
    ed.current?.load("");
    setRoot(""); setTree([]); setPath(""); setText(""); setVersions([]); setCmp(null); setFileCmp(null); setBib([]);
    if (root) update({ lastFolder: "" }); // 关掉单独打开的文件时，不忘掉上次的工作区
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
      // 第一次真正改动：先把打开时的内容存成起点版本，再写入改动
      if (l.needBase) {
        l.needBase = false;
        const v = await be.saveVersion(l.path, l.base, "auto").catch(() => null);
        if (v) { const at = l.path; be.listVersions(at).then((vs) => { if (live.current.path === at) setVersions(vs); }).catch(() => {}); }
      }
      await be.writeText(l.path, l.text);
      l.lastWritten = l.text;
      setSaveState("saved");
      wstats.noteSave(l.path, l.text);
    }
  }

  /** target：从搜索结果、文内链接这类有明确目标的方式打开，不恢复上次的位置 */
  async function openFile(p: string, opts?: { reading?: boolean; target?: boolean; readingDefault?: boolean }) {
    if (!be) return;
    setViewing("");
    if (live.current.path) spots.capture(live.current.path);
    await flush();
    const content = await be.readText(p);
    await commitCheckpoint().catch(() => {});
    live.current = { path: p, text: content, base: content, opened: content, lastWritten: content, lastVersionAt: Date.now(), needBase: true };
    setPath(p); setText(content); setCmp(null); setFileCmp(null); setFresh(null);
    ed.current?.load(content);
    const spot = opts?.target ? null : spots.recall(p);
    reading.afterLoad(p, opts?.reading ?? spot?.reading ?? opts?.readingDefault);
    wstats.noteOpen(p, content);
    if (scroller.current) scroller.current.scrollTop = 0;
    setScrollHeading(0);
    if (spot) spots.restore(spot);
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
        else say("已合并外部修改和你刚写的字", "success");
      }
      const vs = await be.listVersions(p);
      setVersions(vs);
      setFresh(vs[0]?.id ?? null);
    });
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
    await Promise.all([...staged.current.keys()].map((p) => { window.clearTimeout(staged.current.get(p)); return be?.commitStaged(p).catch(() => {}); }));
    staged.current.clear();
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
    spots.capture(live.current.path);
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
    // 光标在第一个标题之前（比如刚打开文件）时没有「本节」，状态栏不显示
    if (!cur) return { total, sec: -1 };
    if (cur) { const next = secs.find((h) => h.pos > cur.pos); sec = countWords(plainText(text.slice(cur.pos, next ? next.pos : undefined)), s.countPunct); }
    return { total, sec };
  }, [total, text, hs, cursor, s.countPunct]);

  const bibMap = useMemo(() => new Map(bib.map((b) => [b.key, b])), [bib]);
  /** 用默认程序打开本机文件（非 Markdown） */
  function openOther(abs: string) {
    if (!be) return;
    if (be.isDemo) { say("浏览器预览里打不开本机文件，桌面版会用默认程序打开", "info"); return; }
    be.openPath(abs).catch((e) => say(reason(e, "没能打开这个文件"), "error"));
  }
  // 文件卡片要用到的操作，经由 ref 调用，免得每次重新渲染都重建编辑器装饰
  const fileHooksRef = useRef<{ open: (abs: string) => void; reveal: (abs: string) => void }>({ open: () => {}, reveal: () => {} });
  fileHooksRef.current = {
    open: (abs) => { if (isMarkdown(abs)) openLinkedMarkdown(abs).catch(() => say("没能打开这个文件", "error")); else openOther(abs); },
    reveal: (abs) => { be?.reveal(abs).catch(() => {}); },
  };
  const preview = useMemo(() => ({
    syntax: () => s.syntax,
    citeLabel: (keys: string[]) => citeText(keys, bibMap),
    citeInfo: (k: string) => bibMap.get(k),
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
      url: (abs: string) => (be ? be.fileUrl(abs) : abs),
      preview: (abs: string) => (be ? be.filePreview(abs) : Promise.reject(new Error("no backend"))),
      open: (abs: string) => fileHooksRef.current.open(abs),
      reveal: (abs: string) => fileHooksRef.current.reveal(abs),
      repick: async () => {
        if (!be || be.isDemo) { say("浏览器预览里不能选择本机文件", "info"); return null; }
        const p = await be.pickFile("重新选择文件");
        return p ? relative(dirOf(live.current.path), p) : null;
      },
    },
    onAtCite: (pos: number) => { if (!bibMap.size) return false; requestAnimationFrame(() => openInsert("@", pos)); return true; },
    // 打开链接只有一个入口（editor/links.ts 的 openLink）：编辑时 ⌘ 点击、阅读模式单击都走这里
    links: {
      docPath: () => live.current.path,
      openUrl: (url: string) => linkRef.current.openUrl(url),
      openFile: (abs: string, md: boolean, anchor?: string) => linkRef.current.openFile(abs, md, anchor),
      jump: (id: string) => linkRef.current.jump!(id),
    },
  }), [s.syntax, bibMap, be]);
  // 文献库按内容判断变没变（条目改了、数量没变时也要刷新引用标签）
  const bibSig = useMemo(() => { let h = 0; for (const b of bib) for (const c of `${b.key}\u0001${b.author}\u0001${b.year}\u0002`) h = (h * 31 + c.charCodeAt(0)) | 0; return h; }, [bib]);
  const previewKey = `${s.syntax}|${bib.length}|${bibSig}`;

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
    if (!v || !path || cmp || reading.on) return;
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

  /* ---------- 新功能 ---------- */
  const openSettings = (pane?: Pane) => { setSettingsPane(pane); setDlg("settings"); };
  const treeOrder = useTreeOrder(be, root, tree);
  const wstats = useWritingStats({ be, tree, livePath: () => live.current.path, liveText: () => live.current.text, withPunct: s.countPunct });
  const symbols = useSymbols(view);
  featureHooks.current.withPunct = () => s.countPunct;
  const spots = useRememberSpot(view, () => scroller.current);
  useSpotAutosave(spots.capture, useCallback(() => live.current.path, []));
  const reading = useReading({
    view, be, livePath: () => live.current.path, resolveImage: (src) => preview.resolveImage(src), bib: bibMap, say,
    followLink: (href) => { openLink(href, linkHooks()); },
  });
  featureHooks.current.reading = reading.hooks;
  /* ---------- N9 在整个文件夹里查找替换 ---------- */
  const replaceFiles = useMemo(() => flatten(tree).filter((f) => /\.(md|markdown)$/i.test(f.name)).map((f) => f.path), [tree]);
  const readForReplace = useCallback(async (p: string) => (p === live.current.path ? live.current.text : be ? be.readText(p) : ""), [be]);
  /** 先给每个要改的文件存一个版本，再写入；当前打开的文件在编辑器里改（进撤销历史）。提示条上可以撤销 */
  async function applyReplace(items: ReplaceItem[]) {
    if (!be) return;
    const cur = live.current.path;
    let count = 0, after: EditorView["state"]["doc"] | null = null, inverse: ChangeSet | null = null;
    for (const it of items) {
      count += it.matches.length;
      folderCache.current.delete(it.path);
      if (it.path === cur) {
        const v = view(); if (!v) continue;
        await flush();
        await be.saveVersion(cur, live.current.text, "auto", undefined, "替换前自动保存").catch(() => null);
        if (v.state.doc.toString() !== it.before) { say("正文刚刚改过，这一篇没有替换，请重新查找"); count -= it.matches.length; continue; }
        const cs = ChangeSet.of(it.matches.map((m) => ({ from: m.from, to: m.to, insert: m.replacement })), v.state.doc.length);
        inverse = cs.invert(v.state.doc);
        v.dispatch({ changes: cs, userEvent: "input.replace" });
        after = v.state.doc;
        await flush();
      } else {
        await be.saveVersion(it.path, it.before, "auto", undefined, "替换前自动保存").catch(() => null);
        await be.writeText(it.path, it.after);
      }
    }
    setDlg(null);
    if (cur) setVersions(await be.listVersions(cur).catch(() => []));
    const files = items.length;
    say(`已在 ${files} 个文件里替换 ${count} 处`, { label: "撤销", run: () => { void (async () => {
      for (const it of items) {
        folderCache.current.delete(it.path);
        if (it.path === live.current.path) {
          const v = view(); if (!v) continue;
          if (inverse && v.state.doc === after) v.dispatch({ changes: inverse, userEvent: "undo.replace" });
          else v.dispatch({ changes: { from: 0, to: v.state.doc.length, insert: it.before } });
          await flush();
        } else await be.writeText(it.path, it.before).catch(() => {});
      }
      say("已撤销替换，替换前的内容都存成了版本");
    })(); } });
  }

  /** N17 复制为带格式的文字：选中的内容，没选中就是全文 */
  function copyFormatted(target: "word" | "wechat") {
    const v = view(); if (!v || !path) return;
    const r = v.state.selection.main;
    const md = r.empty ? v.state.doc.toString() : v.state.sliceDoc(r.from, r.to);
    const what = r.empty ? "全文" : "选中的文字";
    copyRich(md, target, { citeLabel: (k) => citeOne(bibMap.get(k), k), resolveImage: preview.resolveImage, bodyFont: fontStack(layout["body-font"] || s.bodyFont) })
      .then((ok) => say(ok ? (target === "wechat" ? `已复制${what}，可以粘进公众号编辑器` : `已复制${what}，可以粘进 Word 或邮件`) : "没能写进剪贴板"))
      .catch(() => say("没能写进剪贴板"));
  }
  /** 本文里的锚点（规则和 Pandoc 一致，见 lib/anchors.ts）；找不到就用提示条说明，不跳 */
  function jumpAnchor(anchor: string, rec = true) {
    const h = findAnchor(live.current.text, anchor);
    if (h) jump(h.pos, rec); else say(`找不到标题「${anchor}」`, "warn");
    return !!h;
  }
  /** 链接指向的另一篇 Markdown：工作区里的直接打开（保持阅读模式），带锚点就跳过去；工作区以外的单独打开 */
  async function openLinkedMarkdown(abs: string, anchor?: string) {
    const keepReading = reading.on;
    nav.record();
    if (abs !== live.current.path) {
      if (root && isInside(root, abs)) await openFile(abs, { reading: keepReading, target: !!anchor });
      else { await openExternalFile(abs, true); if (live.current.path === abs) reading.set(keepReading); }
    }
    if (anchor && live.current.path === abs) requestAnimationFrame(() => jumpAnchor(anchor, false));
  }
  const linkHooks = (): LinkHooks => ({
    docPath: () => live.current.path,
    openUrl: (url) => {
      if (!be) return;
      be.openUrl(url).catch((e) => say(reason(e, "没能打开这个链接"), "error"));
    },
    openFile: (abs, md, anchor) => { if (md) openLinkedMarkdown(abs, anchor).catch(() => say("没能打开这个文件", "error")); else openOther(abs); },
    jump: (id) => jumpAnchor(id),
  });
  const linkRef = useRef(linkHooks());
  linkRef.current = linkHooks();
  const nav = useNav({ view, livePath: () => live.current.path, open: (p) => openFile(p, { target: true }) });
  /** 阅读模式里不能编辑：改正文的菜单命令不执行 */
  const editsDoc = (id: string) => /^(block_|insert_)/.test(id) || ["bold", "italic", "strike", "code", "math", "highlight", "sup", "sub", "link", "cite", "note", "indent", "outdent", "heading_up", "heading_down", "undo", "redo", "tidy", "math_symbols"].includes(id);
  const tidy = useTidy({ view, rules: s.tidy, text, say, openSettings: () => openSettings("tidy") });

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
    if (reading.on && editsDoc(id)) { say("阅读模式里不能编辑，双击正文或按 " + kbd("⌘⇧R") + " 回到编辑"); return; }
    const block = id.startsWith("block_") ? (id.slice(6) as BlockKind) : null;
    if (block) { if (v) setBlock(v, block); return; }
    const inline = { bold: "bold", italic: "italic", strike: "strike", code: "code", math: "math", highlight: "highlight", sup: "sup", sub: "sub" } as const;
    if (id in inline) { if (v) toggleInline(v, inline[id as keyof typeof inline]); return; }
    switch (id) {
      case "settings": openSettings(); break;
      case "tidy": if (path) tidy.open(); break;
      case "reading": if (path) reading.toggle(); break;
      case "copy_rich": case "copy_wechat": copyFormatted(id === "copy_wechat" ? "wechat" : "word"); break;
      case "folder_replace": if (root) { setReplaceQ(v && !v.state.selection.main.empty ? v.state.sliceDoc(v.state.selection.main.from, v.state.selection.main.to).split("\n")[0] : ""); setDlg("replace"); } break;
      case "nav_back": nav.back(); break;
      case "nav_forward": nav.forward(); break;
      case "math_symbols": if (path) symbols.open(); break;
      case "fold_all": if (v) foldHeadings(v, 1); break;
      case "unfold_all": if (v) unfoldAll(v); break;
      case "fold_h2": if (v) foldToLevel(v, 2); break;
      case "typewriter": update({ typewriter: !s.typewriter }); break;
      case "para_focus": update({ paraFocus: !s.paraFocus }); break;
      case "paper_default": case "paper_cream": case "paper_gray": update({ paper: id.slice(6) as Settings["paper"] }); break;
      case "close_preview": setViewing(""); break;
      case "new_file": newFile(); break;
      case "open_folder": chooseFolder(); break;
      case "close_folder": closeFolder(); break;
      case "save_version": if (path) checkpoint(); break;
      case "find": ed.current?.find(); break;
      case "search": setDlg((d) => (d === "palette" ? null : "palette")); break;
      case "link": if (v) insertLink(v); break;
      case "cite": openInsert(); break;
      case "note": if (v && !insertNote(v)) say("先选中要批注的文字", "warn"); break;
      case "insert_table": if (v) insertBlock(v, tableMarkdown(2, 3), 2); break;
      case "insert_code": if (v) insertBlock(v, "```\n\n```", 4); break;
      case "insert_math": if (v) insertBlock(v, "$$\n\n$$", 3); break;
      case "insert_mermaid": if (v) insertBlock(v, "```mermaid\nflowchart LR\n  A[开始] --> B[结束]\n```", 11); break;
      case "insert_image": pickImage(); break;
      case "insert_hr": if (v) insertBlock(v, "---"); break;
      case "toggle_side": toggleSide(); break;
      case "toggle_panel": togglePanel(); break;
      case "toggle_ribbon": update({ ribbonCollapsed: !s.ribbonCollapsed }); break;
      case "focus": setFocus((x) => !x); break;
      case "panel_outline": openPanel(); setTab("outline"); break;
      case "panel_notes": openPanel(); setTab("notes"); break;
      case "panel_versions": openPanel(); setTab("versions"); break;
      case "toggle_syntax": update({ syntax: s.syntax === "always" ? "active" : "always" }); break;
      case "help_syntax": setDlg("help_syntax"); break;
      case "help_keys": setDlg("help_keys"); break;
      case "save_version_named": if (path) setDlg("save"); break;
      case "compare_file": if (path) setDlg("cmpfile"); break;
      case "import_docx": importDocx(); break;
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
  // 自定义快捷键（N15）：启动时从设置里恢复；之后改了就存回设置（原生菜单的重建见下面）
  useEffect(() => {
    loadShortcuts(sRef.current.shortcuts);
    return onShortcutsChange(() => update({ shortcuts: customShortcuts() }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  // macOS 原生菜单按命令注册表生成；快捷键在运行时改了就重建（G6）
  useEffect(() => {
    if (!be || be.isDemo || !nativeMenu) return;
    const sync = () => { be.setMenu(menuSpec(), accelOf(shortcutOf("settings"))).catch(() => {}); };
    sync();
    return onShortcutsChange(sync);
  }, [be]);

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
  function jump(pos: number, rec = true) {
    const v = view(); if (!v) return;
    if (rec) nav.record();
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
    say("批注已解决", "success", { label: "撤销", run: () => ed.current?.undo() });
  }
  function applyLayout(l: Record<string, string>) {
    const v = view(); if (!v) return;
    const next = setDocLayout(v.state.doc.toString(), l);
    v.dispatch({ changes: { from: 0, to: v.state.doc.length, insert: next } });
    say(Object.keys(l).some((k) => l[k]) ? "已写入本文属性区" : "已清除本文版式", "success");
  }
  /**
   * ⌘S 是不打断的存档点（G1）：马上提示「已存档」，提示条上带「起个名字」，点了才弹出起名字的对话框。
   * 存档点的版本在提示条消失后记下（这期间点了「起个名字」就带着名字记一条，不会记两条）；
   * 换文件、关窗口、刷新前会先记下。文件本身一直在自动保存。
   */
  const pendingCk = useRef<{ timer: number; path: string; text: string } | null>(null);
  async function commitCheckpoint(name?: string, note?: string) {
    const ck = pendingCk.current;
    if (!ck || !be) return;
    window.clearTimeout(ck.timer);
    pendingCk.current = null;
    await be.saveVersion(ck.path, ck.text, "saved", name || undefined, note || undefined);
    if (ck.path === live.current.path) setVersions(await be.listVersions(ck.path));
  }
  async function checkpoint() {
    if (!be || !path) return;
    await flush();
    await commitCheckpoint();
    live.current.lastVersionAt = Date.now();
    live.current.base = live.current.text;
    pendingCk.current = { path, text: live.current.text, timer: window.setTimeout(() => { commitCheckpoint().catch(() => {}); }, 6500) };
    say("已存档", "success", { label: "起个名字", run: () => { if (pendingCk.current) window.clearTimeout(pendingCk.current.timer); setDlg("save"); } });
  }
  async function saveVersion(name: string, note: string) {
    if (!be || !path) return;
    await flush();
    if (pendingCk.current) await commitCheckpoint(name, note);
    else await be.saveVersion(path, live.current.text, "saved", name, note || undefined);
    live.current.lastVersionAt = Date.now();
    live.current.base = live.current.text;
    setVersions(await be.listVersions(path));
    setDlg(null);
    say(`已存档「${name}」`, "success");
  }
  /** 撤销这次打开以来的所有修改：现在的内容先存成版本，再回到打开时的样子（提示条带「撤销」） */
  async function revertToOpened() {
    const v = view(); if (!v || !be || !path) return;
    const l = live.current;
    if (l.text === l.opened) return;
    await flush();
    await be.saveVersion(path, l.text, "auto", undefined, "撤销这次打开以来的修改之前").catch(() => null);
    v.dispatch({ changes: { from: 0, to: v.state.doc.length, insert: l.opened } });
    setVersions(await be.listVersions(path));
    say("已回到这次打开时的样子", "success", { label: "撤销", run: () => ed.current?.undo() });
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
  /** 只恢复某一段（N19）：先存一个版本，再在编辑器里改（进撤销历史），对比视图跟着刷新，提示条带「撤销」 */
  async function restoreBlock(kind: "restore" | "remove", i: number) {
    const v = view();
    if (!be || !cmp || !v) return;
    await flush();
    const now = live.current.text;
    const rows = alignWithRanges(cmp.oldText, now);
    const fix = kind === "restore" ? restoreRow(now, rows, i) : removeRow(now, rows, i);
    if (!fix) return;
    await be.saveVersion(path, now, "auto", undefined, kind === "restore" ? "恢复这一段前自动保存" : "移除这一段前自动保存").catch(() => null);
    v.dispatch({ changes: fix, userEvent: kind === "restore" ? "input.restore" : "delete.restore" });
    ed.current?.flash(changedLines(now, live.current.text));
    setText(live.current.text);
    setCmp((c) => c && { ...c, newText: live.current.text, same: false });
    await flush();
    setVersions(await be.listVersions(path).catch(() => []));
    say(kind === "restore" ? "已恢复这一段" : "已移除这一段", "success", { label: "撤销", run: () => {
      ed.current?.undo();
      setText(live.current.text);
      setCmp((c) => c && { ...c, newText: live.current.text });
      void flush();
    } });
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
        const dest = await be.saveImage(join(dirOf(path), s.imageDir || "assets"), name, await toB64(f));
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
    setBatch(null);
    setDlg("export");
  }
  const resolveImage = useCallback((src: string) => preview.resolveImage(src), [preview]);

  /* ---------- 文件管理（右键菜单）---------- */
  const refreshTree = async () => { if (be && root) setTree(sortTree(await be.listTree(root))); };
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
    treeOrder.renamed(from, to);
    wstats.noteMove(from, to);
    spots.move(from, to);
    nav.rename(from, to);
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
    autoName.current.delete(p); saveAutoName(); // 手动改过名：文件名不再跟着标题走
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
  async function moveTo(node: TreeNode, dir: string): Promise<string | null> {
    if (!be) return null;
    try {
      await flush();
      const to = await be.movePath(node.path, dir);
      await refreshTree();
      await followMove(node.path, to);
      const from = dirOf(node.path);
      undoable(`已把「${node.name}」移到「${dir === root ? baseName(root) : relative(root, dir)}」`, async () => { await be.movePath(to, from); await followMove(to, node.path); });
      return to;
    } catch (e) { say(String(e).replace(/^Error:\s*/, ""), "error"); return null; }
  }
  /** 手动排序（N18）：拖到某一项前后。跨文件夹时先移动过去，再排位置 */
  async function reorderTree(node: TreeNode, dir: string, before: string | null) {
    const prev = treeOrder.order;
    if (dirOf(node.path) !== dir) {
      const to = await moveTo(node, dir);
      if (to) treeOrder.reorder(dir, baseName(to), before);
      return;
    }
    treeOrder.reorder(dir, node.name, before);
    say("已调整顺序", "success", { label: "撤销", run: () => treeOrder.restore(prev) });
  }
  async function trash(node: TreeNode) {
    if (!be) return;
    try {
      const cur = live.current.path;
      const inside = cur === node.path || cur.startsWith(node.path + "/");
      nav.rename(node.path, null);
      if (inside) await flush();
      const hold = await be.stageDelete(node.path);
      const orderBefore = treeOrder.order;
      treeOrder.removed(node.path);
      staged.current.set(hold, window.setTimeout(() => commitStaged(hold), 6500));
      const t = await be.listTree(root);
      setTree(sortTree(t));
      if (inside) {
        const next = flatten(t).find((f) => /\.(md|markdown)$/i.test(f.name));
        if (next) await openFile(next.path);
        else { live.current = { path: "", text: "", base: "", opened: "", lastWritten: "", lastVersionAt: 0 }; setPath(""); setText(""); setVersions([]); }
      }
      undoable(`已把「${node.name}」移到${trashName}`, async () => {
        window.clearTimeout(staged.current.get(hold)); staged.current.delete(hold);
        await be.restoreStaged(hold, node.path);
        treeOrder.restore(orderBefore);
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
      { label: "新建文稿", icon: "filePlus", hint: "⌘N", run: () => newFile(root) },
      { label: "新建文件夹", icon: "folderPlus", run: () => newFolder(root) },
      { sep: true },
      { label: reveal, icon: "open", run: () => be?.reveal(root) },
      { label: "刷新", icon: "reset", run: refreshTree },
    ];
    const md = /\.(md|markdown)$/i.test(node.name);
    return [
      ...(node.dir ? [
        { label: "新建文稿", icon: "filePlus", run: () => newFile(node.path) },
        { label: "新建文件夹", icon: "folderPlus", run: () => newFolder(node.path) },
        { label: "导出这个文件夹…", icon: "export", run: () => exportFolder(node) },
        { sep: true } as MenuEntry,
      ] : !md ? [
        { label: "用默认程序打开", icon: "external", run: () => be?.openPath(node.path).catch(() => say("没能打开这个文件", "error")) },
        { sep: true } as MenuEntry,
      ] : md ? [
        { label: "打开", icon: "doc", run: () => openFile(node.path) },
        ...(node.path !== path && path ? [{ label: "与当前文稿对比", icon: "compare", run: () => compareWith(node.path) }] : []),
        { sep: true } as MenuEntry,
      ] : []),
      { label: "重命名", icon: "edit", run: () => setRenaming(node.path) },
      ...(!node.dir ? [{ label: "创建副本", icon: "copy", run: async () => { if (!be) return; const c = await be.duplicatePath(node.path); await refreshTree(); undoable(`已创建「${baseName(c)}」`, () => be.trashPath(c)); } }] : []),
      { label: "移动到…", icon: "moveTo", run: () => { setMoving(node); setDlg("move"); } },
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
    ...(root ? [
      { label: isWindows ? "在资源管理器中显示" : "在访达中显示", icon: "open", run: () => be?.reveal(root) },
      { sep: true } as MenuEntry,
      // 排序方式（N18）：按名称 / 手动拖动
      { head: "排序方式" } as MenuEntry,
      { label: "按名称", icon: treeOrder.manual ? "" : "check", run: () => treeOrder.setMode("name") },
      { label: "手动拖动", icon: treeOrder.manual ? "check" : "", hint: treeOrder.manual ? "" : "拖动调整顺序", run: () => { treeOrder.setMode("manual"); say("已改成手动排序：在左栏拖动文件调整顺序", "info"); } },
      { sep: true } as MenuEntry,
      { label: "关闭文件夹", icon: "close", run: closeFolder },
    ] : []),
    ...(single && !root ? [{ label: "打开所在文件夹", icon: "folderOpen", run: adoptSingleFolder }, { label: isWindows ? "在资源管理器中显示" : "在访达中显示", icon: "open", run: () => be?.reveal(single) }, { sep: true } as MenuEntry, { label: "关闭这个文件", icon: "close", run: closeFolder }] : []),
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
  function jumpTo(pos: number, len: number, rec = true) {
    const v = view(); if (!v) return;
    if (rec) nav.record();
    setCmp(null); setFileCmp(null);
    const at = Math.min(pos, v.state.doc.length);
    v.dispatch({ selection: { anchor: at, head: Math.min(at + len, v.state.doc.length) }, effects: EditorView.scrollIntoView(at, { y: "center" }) });
    v.focus();
  }
  async function openAt(p: string, pos: number, len: number) {
    nav.record();
    if (p !== live.current.path) await openFile(p, { target: true });
    requestAnimationFrame(() => jumpTo(pos, len, false));
  }

  /** 命令此刻能不能用（⌘K 里只列能用的） */
  function commandAvailable(id: string) {
    switch (id) {
      case "close_folder": return !!(root || single);
      case "nav_back": return nav.canBack;
      case "nav_forward": return nav.canForward;
      case "close_preview": return !!viewing;
      case "folder_replace": return !!root;
      case "paper_default": case "paper_cream": case "paper_gray": return s.paper !== id.slice(6);
      case "reading": case "fold_all": case "unfold_all": case "fold_h2": case "tidy": case "math_symbols": case "copy_rich": case "copy_wechat": return !!path;
      default: return true;
    }
  }
  /** 开关类命令现在是不是开着（⌘K 里显示「退出…」「关闭…」） */
  function commandOn(id: string) {
    return id === "reading" ? reading.on : id === "typewriter" ? s.typewriter : id === "para_focus" ? s.paraFocus : false;
  }
  // ⌘K 里的命令由命令注册表生成：能搜到所有命令（G6）
  const commands: PaletteItem[] = [
    ...COMMANDS.filter((c) => !c.hidden && commandAvailable(c.id)).map((c) => ({
      group: "命令", icon: COMMAND_ICON[c.id] ?? "cmd", title: (c.onTitle && commandOn(c.id) ? c.onTitle : c.paletteTitle ?? c.title), sub: c.sub ?? c.alias,
      keys: shortcutOf(c.id) ? keyCaps(shortcutOf(c.id)!) : undefined,
      run: () => setTimeout(() => menuRef.current(c.id), 0),
    })),
    ...hs.filter((h) => h.level >= 2).map((h) => ({ group: "跳转", icon: "go", title: h.text, run: () => jump(h.pos) })),
  ];
  /* ---------- 插入文件链接（⌘⇧C）：光标处的小浮层 ---------- */
  /** 插入浮层：位置；atPos 是在正文里打 @ 弹出时那个 @ 的位置（选中文献后把它换掉，G11） */
  const [insertAt, setInsertAt] = useState<{ left: number; top: number; bottom: number; q?: string; atPos?: number } | null>(null);
  const RECENT_KEY = "holymark-recent-insert";
  const [recentIns, setRecentIns] = useState<string[]>(() => { try { return JSON.parse(localStorage.getItem(RECENT_KEY) || "[]"); } catch { return []; } });
  const rememberInsert = (p: string) => setRecentIns((r) => {
    const n = [p, ...r.filter((x) => x !== p)].slice(0, 12);
    try { localStorage.setItem(RECENT_KEY, JSON.stringify(n)); } catch { /* 存不了就算了 */ }
    return n;
  });
  function openInsert(q?: string, atPos?: number) {
    const v = view(); if (!v || !path) return;
    const c = v.coordsAtPos(v.state.selection.main.head);
    const r = c ?? (() => { const b = v.contentDOM.getBoundingClientRect(); return { left: b.left, top: b.top + 40, bottom: b.top + 60 }; })();
    setInsertAt({ left: Math.round(r.left), top: Math.round(r.top), bottom: Math.round(r.bottom), q, atPos });
  }
  function pickInsert(p: InsertPick) {
    const at = insertAt?.atPos;
    setInsertAt(null);
    if (p.kind === "bib") {
      // 正文里打 @ 弹出的：把那个 @ 换成 [@key]
      const v = view();
      if (v && at !== undefined && v.state.sliceDoc(at, at + 1) === "@") {
        const t = `[@${p.key}]`;
        v.dispatch({ changes: { from: at, to: v.state.selection.main.head > at ? v.state.selection.main.head : at + 1, insert: t }, selection: { anchor: at + t.length } });
        v.focus();
        return;
      }
      insertAtCursor(`[@${p.key}]`); return;
    }
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
          try { src = await be.copyIntoFolder(p, join(dirOf(path), s.imageDir || "assets")); copied++; } catch (e) { say(`图片复制失败：${e}`, "error"); continue; }
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
  const APP_LEVEL = useMemo(() => new Set(["folder_replace", "reading", "search", "save_version", "export", "settings", "focus", "toggle_side", "toggle_panel", "toggle_ribbon", "new_file", "open_folder", "panel_outline", "panel_notes", "panel_versions"]), []);
  const MAC_FALLBACK = useMemo(() => new Set(["reading", "search", "save_version", "settings", "focus", "toggle_side", "toggle_panel", "new_file", "open_folder"]), []);
  useEffect(() => {
    const f = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !dlg && viewing) { setViewing(""); return; }
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

  const appCls = [narrow ? "narrow" : "", drawer ? "drawer-" + drawer : "", s.eqNumbers ? "eqnum" : "", s.typewriter ? "typewriter" : "", s.paraFocus ? "parafocus" : "", "app", showSide ? "" : "no-side", showPanel && path ? "" : "no-panel", focus ? "focus" : "", isTauri && isMac ? "mac" : "", customFrame ? "framed" : ""].join(" ");
  const fileName = baseName(path);
  // 标题栏路径：和文件树一样不显示 .md；中间的文件夹可以省略，最后的文稿名中间截断（F12、F4）。
  // 正在预览非 Markdown 文件时显示那个文件；单独打开的文件只显示文件名
  const shown = viewing || path;
  const crumbs = (shown && root && isInside(root, shown) ? relative(root, shown).split("/") : path && single ? [baseName(path)] : [])
    .map((c, i, a) => (i === a.length - 1 && !viewing ? stripMd(c) : c));

  return (
    <div className={appCls} style={{ ...editorStyle, "--sw0": `${s.sideWidth}px`, "--pw0": `${s.panelWidth}px` } as React.CSSProperties} data-paper={s.paper}>
      <header className="titlebar" data-tauri-drag-region>
        <button className="ib" title={tipOf("toggle_side")} aria-label="显示 / 隐藏侧栏" onClick={toggleSide}><Icon name="side" /></button>
        {nav.arrows}
        <div className="crumbs" data-tauri-drag-region>
          {root && <span>{baseName(root)}</span>}
          {crumbs.map((c, i) => <span key={i} className={"crumb" + (i === crumbs.length - 1 ? " last" : "") + (!root && crumbs.length === 1 ? " solo" : "")}>{(root || i > 0) && <span className="sep">/</span>}{i === crumbs.length - 1 ? <b><MidName name={c} tail={6} /></b> : <span className="cn" title={c}>{c}</span>}</span>)}
        </div>
        <div className="spacer" data-tauri-drag-region />
        {path && saveState === "error" && <div className="savestate" role="alert" title="自动保存没有成功，继续编辑会再次尝试"><i />保存失败</div>}
        <button className="searchbtn" onClick={() => setDlg("palette")} aria-label="搜索或执行命令"><Icon name="search" size={14} /><span className="lbl">搜索</span><kbd>{kbd("⌘K")}</kbd></button>
        {path && <button className={"ib" + (reading.on ? " on" : "")} title={tipOf("reading", reading.on ? "退出阅读模式" : "阅读模式")} aria-label="阅读模式" aria-pressed={reading.on} onClick={reading.toggle}><Icon name="book" /></button>}
        {focus && path && <button className={"ib" + (s.paraFocus ? " on" : "")} title="段落聚焦：其他段落变淡" aria-label="段落聚焦" aria-pressed={s.paraFocus} onClick={() => update({ paraFocus: !s.paraFocus })}><Icon name="parafocus" /></button>}
        <button className={"ib" + (focus ? " on" : "")} title={tipOf("focus")} aria-label="专注模式" onClick={() => setFocus(!focus)}><Icon name="focus" /></button>
        <button className="ib" title={tipOf("export", "导出")} aria-label="导出" disabled={!path} onClick={openExport}><Icon name="export" /></button>
        <button className="ib" title={tipOf("toggle_panel")} aria-label="显示 / 隐藏右栏" onClick={togglePanel}><Icon name="panel" /></button>
        {customFrame && <WindowControls />}
      </header>

      {showSide && !focus && !narrow && <Resizer side="left" value={s.sideWidth} min={180} max={420} def={248} onChange={(w) => update({ sideWidth: w })} />}
      {showPanel && path && !focus && !narrow && <Resizer side="right" value={s.panelWidth} min={240} max={520} def={300} onChange={(w) => update({ panelWidth: w })} />}
      <aside className="side" aria-label="文件夹">
        <div className="side-in">
          <div className="side-scroll" onScroll={(e) => e.currentTarget.classList.toggle("scrolled", e.currentTarget.scrollTop > 2)}>
            <button className={"folder" + (root || single ? "" : " none")} onClick={(e) => { if (!root && !single) { chooseFolder(); return; } const r = e.currentTarget.getBoundingClientRect(); setFolderMenu({ x: r.left + 8, y: r.bottom }); }} title={root ? root : single ? single : "选择一个放稿件的文件夹"} aria-haspopup="menu">
              <span className="fname">{root ? baseName(root) : single ? "单个文件" : "打开文件夹"}{(root || single) && <Icon name="chev" size={12} />}</span>
              <span className="fpath">{root ? shortPath(root) : single ? shortPath(dirOf(single)) : "选择一个放稿件的文件夹"}</span>
            </button>
            {single && !root && <button className="tn single-open" onClick={adoptSingleFolder} title={`把「${baseName(dirOf(single))}」当作工作区打开，这篇的版本一起带过去`}>
              <span className="slot"><Icon name="folderOpen" size={14} /></span><span className="nm">打开所在文件夹</span></button>}
            <FileTree nodes={treeOrder.shown} root={root} manual={treeOrder.manual} onReorder={(n, d, b) => { void reorderTree(n, d, b); }} current={viewing || path} onOpen={openFromTree} onPreview={openFromTree} showAll={s.showAllFiles} renaming={renaming} onRename={renameDone}
              onOpenOther={openOther}
              onStartRename={setRenaming} onDelete={(n) => trash(n)} onMove={(n, d) => moveTo(n, d)}
              onMenu={(e, node) => { if (root) setTreeMenu({ x: e.clientX, y: e.clientY, node }); }} />
          </div>
          {/* Mac 上设置在菜单栏「HolyMark → 设置…」里，左下角不再放 */}
          {!nativeMenu && <div className="side-foot"><button className="tn" onClick={() => setDlg("settings")}><span className="ico"><Icon name="gear" size={14} /></span><span className="nm">设置</span><span className="ext">{kbd("⌘,")}</span></button></div>}
        </div>
      </aside>

      <main className="main" onMouseDown={() => { if (drawer) setDrawer(null); }}>
        {path && !reading.on && !viewing && <Ribbon view={ed.current?.view() ?? null} author={noteAuthor()} settings={s} fonts={fonts} layout={layout} onLayout={applyLayout}
          collapsed={s.ribbonCollapsed} setCollapsed={(c) => update({ ribbonCollapsed: c })}
          onPickImage={pickImage} onCite={openInsert} active={fmt.active} block={fmt.block} onTidy={tidy.open} />}
        <div className="scroller" ref={scroller} onScroll={() => window.requestAnimationFrame(syncScrollHeading)} onMouseDown={clickBelow}>
          <div className="doc">
            {!path && <Welcome hasRoot={!!root} recent={s.recentFolders} onOpen={chooseFolder} onNew={() => newFile()} onRecent={(f) => openFolder(f).catch((e) => { if (String(e).includes("重新选择")) { say(String(e), "warn"); return; } say("这个文件夹已经不在了", "warn"); update({ recentFolders: s.recentFolders.filter((x) => x !== f) }); })} />}
            <div hidden={!path}><Editor ref={ed} initial="" preview={preview} previewKey={previewKey} onChange={onChange} onSelection={onSelection} onImages={insertImages} extra={extra} /></div>
          </div>
        </div>
        {!reading.on && !viewing && <FloatingToolbar view={ed.current?.view() ?? null} tick={tick} author={noteAuthor()} active={fmt.active} />}
        {viewing && be && <FileViewer be={be} path={viewing} onInfo={setViewInfo} say={say} onOpenDefault={openOther} />}
        {fileCmp && <Compare fileLabel={fileCmp.name} oldText={fileCmp.text} newText={live.current.text} against="current" hasPrev={false} prevLabel=""
          onAgainst={() => {}} onClose={() => setFileCmp(null)} onRestore={() => {}} onPick={() => setDlg("cmpfile")} />}
        {cmp && (
          <Compare version={cmp.v} oldText={cmp.oldText} newText={cmp.newText} against={cmp.against} sameAsNow={cmp.same}
            hasPrev={versions.findIndex((x) => x.id === cmp.v.id) < versions.length - 1}
            prevLabel={(() => { const p = versions[versions.findIndex((x) => x.id === cmp.v.id) + 1]; if (!p) return ""; const t = fmtTime(p.at); return `${versionTitle(p)} · ${t.day} ${t.hm}`; })()}
            onAgainst={(a) => openVersion(cmp.v.id, a)} onClose={() => setCmp(null)} onRestore={restore} onBlock={(k, i) => { void restoreBlock(k, i); }} />
        )}
      </main>

      <aside className="panel" aria-label="当前文件">
        {viewing ? <FileInfo info={viewInfo} path={viewing} /> : <>
        <SidePanel tab={tab} setTab={setTab} headings={hs} currentHeading={currentHeading} notes={notes} versions={versions} freshVersion={fresh}
          selectedVersion={cmp?.v.id ?? null} fileName={fileName} onJump={jump} onResolve={resolveNote} cursorPos={cursor}
          path={path} readVersion={(p, id) => be ? be.readVersion(p, id) : Promise.resolve("")}
          onAddHeading={() => { const v = view(); if (v) { setBlock(v, "h1"); v.focus(); } }} onAddNote={() => menuRef.current("note")}
          onOpenVersion={(id) => openVersion(id)} onSaveVersion={() => setDlg("save")} onCompareFile={() => setDlg("cmpfile")}
          canRevert={!!path && text !== live.current.opened} onRevert={revertToOpened}
          onMoveHeading={reading.on ? undefined : (from, before) => { const v = view(); if (v) moveSection(v, from, before ?? v.state.doc.length); }} /></>}
      </aside>

      <footer className="statusbar">
        {/* 没有打开文稿时状态栏不显示字数（F11）；光标在第一个标题之前时不显示「本节」 */}
        {path && stats.sec >= 0 && <span className="sb">本节 <b>{stats.sec.toLocaleString()}</b></span>}
        {path && <button className={"sb" + (countPop?.title === "全文" ? " on" : "")} data-countpop aria-expanded={countPop?.title === "全文"} onClick={(e) => toggleCount("全文", plainText(text), e.currentTarget)}>全文 <b>{stats.total.toLocaleString()}</b>{s.goalOn && <span className="goal"> / {s.goal.toLocaleString()}</span>}</button>}
        {selText && <button className={"sb sel" + (countPop?.title === "选中的文字" ? " on" : "")} data-countpop aria-expanded={countPop?.title === "选中的文字"} onMouseDown={(e) => e.preventDefault()} onClick={(e) => toggleCount("选中的文字", plainText(selText), e.currentTarget)}>选中 <b>{countWords(plainText(selText), s.countPunct).toLocaleString()}</b></button>}
        {/* 写作目标：同一个数只出现一次，进度条跟在「全文」后面（H32） */}
        {path && s.goalOn && <div className="goalbar" title={`写作目标 ${s.goal.toLocaleString()} 字，已完成 ${Math.min(100, Math.round((stats.total / s.goal) * 100))}%`}><i style={{ width: `${Math.min(100, (stats.total / s.goal) * 100)}%` }} /></div>}
        {be?.isDemo && <span className="sb demo-tag" title="浏览器里用的是内置的演示文件夹，不会读写你的文件">浏览器预览</span>}
      </footer>

      <Presence>{countPop && <CountPop title={countPop.title} text={countPop.text} count={count} anchor={countPop.rect} onClose={() => setCountPop(null)}>{countPop.title === "全文" && <wstats.Section />}</CountPop>}</Presence>
      <Presence>{dlg === "save" && <SaveVersionDialog changes={saveChanges} fileName={fileName} onSave={saveVersion} onClose={() => { setDlg(null); commitCheckpoint().catch(() => {}); }} />}</Presence>
      <Presence>{dlg === "settings" && <SettingsDialog s={s} fonts={fonts} onChange={update} initialPane={settingsPane} onClose={() => setDlg(null)} onReset={() => {
        // 恢复默认设置：最近打开的文件夹、上次的文件夹、批注署名、自定义快捷键这类「记住的东西」保留（快捷键在快捷键页单独恢复）；提示条带撤销
        const before = s;
        const keep = { lastFolder: s.lastFolder, recentFolders: s.recentFolders, noteAuthor: s.noteAuthor, shortcuts: s.shortcuts, v: s.v };
        update({ ...DEFAULTS, ...keep });
        say("已恢复默认设置", "success", { label: "撤销", run: () => update(before) });
      }} />}</Presence>
      <Presence>{(dlg === "help_syntax" || dlg === "help_keys") && <HelpDialog kind={dlg === "help_syntax" ? "syntax" : "keys"} onClose={() => setDlg(null)} />}</Presence>
      <Presence>{dlg === "palette" && <SearchPanel text={live.current.text} path={path} root={root} headings={hs} folderTexts={folderTexts} commands={commands}
        onJump={jumpTo} onOpenAt={openAt} onClose={() => setDlg(null)} onReplace={root ? (q) => { setReplaceQ(q); setDlg("replace"); } : undefined} />}</Presence>
      <Presence>{dlg === "replace" && <FolderReplace files={replaceFiles} root={root} read={readForReplace} initial={replaceQ} onApply={applyReplace} onClose={() => { setDlg(null); view()?.focus(); }} />}</Presence>
      <Presence ms={100}>{insertAt && <InsertFile at={insertAt} initialQuery={insertAt.q} files={flatten(tree)} docPath={path} root={root} bib={bib} recent={recentIns}
        doi={root ? { targets: doiTargets(tree, root), add: async (d, t) => {
          if (!be) throw new Error("还没准备好");
          const r = await addDoiEntry(be, d, t, bib, tree);
          setBib(r.entries);
          if (t.isNew) await refreshTree();
          say(`已把这篇文献加进 ${t.label.replace(/（新建）$/, "")}，引用键 ${r.key}`, "success");
          return r.key;
        } } : undefined}
        onPick={pickInsert} onPickOther={() => { setInsertAt(null); setTimeout(citeOtherFile, 0); }} onClose={() => { setInsertAt(null); view()?.focus(); }} />}</Presence>
      {tidy.node}
      {symbols.node}
      {reading.node}
      <Presence>{dlg === "export" && be && <ExportDialog be={be} path={path} root={root} text={text} tree={tree} bib={bib} fonts={fonts} resolveImage={resolveImage} onClose={() => { setDlg(null); if (batch) refreshTree(); setBatch(null); }} say={say} batch={batch ?? undefined} />}</Presence>
      <Presence>{dlg === "cmpfile" && <Palette items={cmpItems} search={noSearch} pinned={cmpPick} onClose={() => setDlg(null)} placeholder="选一篇文稿，和当前文稿左右对比" />}</Presence>
      <Presence>{dlg === "move" && moving && <Palette items={moveItems} search={noSearch} onClose={() => { setDlg(null); setMoving(null); }} placeholder={`把「${moving.name}」移到哪个文件夹`} />}</Presence>
      {treeMenu && <Menu x={treeMenu.x} y={treeMenu.y} items={treeMenuItems(treeMenu.node)} onClose={() => setTreeMenu(null)} />}
      {folderMenu && <Menu x={folderMenu.x} y={folderMenu.y} items={folderMenuItems()} onClose={() => setFolderMenu(null)} minWidth={232} />}
      {dropCaret && <div className="dropcaret" style={{ left: dropCaret.left, top: dropCaret.top, height: dropCaret.height }} aria-hidden="true" />}
      <Presence>{toast && <div className={"toast " + toast.kind} role="status">{toast.kind !== "info" && <i aria-hidden="true" />}{toast.msg}{toast.actions.map((a) => <button key={a.label} className="lnk" onClick={() => { a.run(); setToast(null); }}>{a.label}</button>)}</div>}</Presence>
      <TooltipLayer />
    </div>
  );
}
