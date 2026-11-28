import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { EditorView } from "@codemirror/view";
import { Editor, EditorHandle } from "./editor/Editor";
import type { PreviewOptions } from "./editor/livePreview";
import { Backend, demoImages, FontFamily, getBackend, isTauri, TreeNode } from "./lib/backend";
import { countWords, docLayout, headings, Note, parseNotes, plainText, wordCounter } from "./lib/markdown";
import { applyAccent, DEFAULTS, fontStack, loadSettings, saveSettings, Settings } from "./lib/settings";
import { BibEntry, citeText } from "./lib/bib";
import { FileTree } from "./components/FileTree";
import { FloatingToolbar, Ribbon } from "./components/Toolbars";
import { activeStyles, BlockKind, currentBlock, InlineKind, setBlock } from "./editor/commands";
import { fmtTime, PanelTab, SidePanel, versionTitle } from "./components/SidePanel";
import { Compare } from "./components/Compare";
import { CountPop, HelpDialog, Palette, PaletteItem, Pane, SaveVersionDialog, SettingsDialog } from "./components/Dialogs";
import { Icon } from "./components/Icons";
import { Presence } from "./components/Presence";
import { WindowControls } from "./components/WindowControls";
import { Menu } from "./components/Menu";
import { SearchPanel } from "./components/Search";
import { InsertFile } from "./components/InsertFile";
import { baseName, dirOf, isInside, isMarkdown, join, normalize, relative, stripMd, toPosix } from "./lib/paths";
import { MidName } from "./components/MidName";
import { TooltipLayer } from "./components/Tooltip";
import { isMac, kbd } from "./lib/platform";
import { tipOf } from "./lib/commandRegistry";
import { ExportDialog } from "./components/ExportDialog";
import { FeatureHooks, features } from "./editor/features";
import { useTidy } from "./features/useTidy";
import { useWritingStats } from "./features/useWritingStats";
import { useSymbols } from "./features/useSymbols";
import { useReading } from "./features/useReading";
import { useRememberSpot, useSpotAutosave } from "./features/useRememberSpot";
import { useNav } from "./features/useNav";
import { FileInfo, FileViewer } from "./components/FileViewer";
import { previewKind, type FilePreview } from "./lib/filePreview";
import { addDoiEntry, doiTargets } from "./features/useDoi";
import { FolderReplace } from "./components/FolderReplace";
import { findAnchor } from "./lib/anchors";
import { LinkHooks, openLink } from "./editor/links";
import { moveSection } from "./editor/blockMoves";
import { useTreeOrder } from "./features/useTreeOrder";
import { useRefPane } from "./features/useRefPane";
import { RefPane } from "./features/RefPane";
import { Segmented } from "./components/Segmented";
import { noteAuthor, setNoteAuthor } from "./editor/notes";
import { NoticeAction, NoticeKind, setNotifier } from "./editor/notice";
import { customFrame, DlgKind, flatten, LiveDoc, nativeMenu, reason, Resizer, SayFn, shortPath, Welcome } from "./app/appUtils";
import { useVersions } from "./app/useVersions";
import { useDocument } from "./app/useDocument";
import { useWorkspace } from "./app/useWorkspace";
import { useInsertAndDrop } from "./app/useInsertAndDrop";
import { useCommands } from "./app/useCommands";

export default function App() {
  /* ---------- 核心共享状态 ---------- */
  const [s, setS] = useState<Settings>(loadSettings);
  const [be, setBe] = useState<Backend | null>(null);
  const [root, setRoot] = useState("");
  /** 单独打开的文件（不在工作区里）：只有这一个文件，不扫描它所在的文件夹 */
  const [single, setSingle] = useState("");
  const [tree, setTree] = useState<TreeNode[]>([]);
  const [path, setPath] = useState("");
  const [text, setText] = useState("");
  const [bib, setBib] = useState<BibEntry[]>([]);
  /** 正文区正在预览的非 Markdown 文件（N5）；编辑器一直挂着，切回去照旧 */
  const [viewing, setViewing] = useState("");
  const [viewInfo, setViewInfo] = useState<FilePreview | null>(null);

  /* ---------- 布局、面板与对话框状态 ---------- */
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
  const [dlg, setDlg] = useState<DlgKind>(null);
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
  const [countPop, setCountPop] = useState<{ title: string; text: string; rect: DOMRect } | null>(null);
  const [toast, setToast] = useState<{ msg: string; kind: NoticeKind; actions: NoticeAction[] } | null>(null);

  const ed = useRef<EditorHandle>(null);
  const live = useRef<LiveDoc>({ path: "", text: "", base: "", opened: "", lastWritten: "", lastVersionAt: 0 });
  const view = (): EditorView | null => ed.current?.view() ?? null;

  /** 跨领域 hook 的延迟绑定桥接（只会在事件或异步回调中触发） */
  const bridge = useRef({
    flush: async () => {},
    openFile: async (_p: string, _opts?: { reading?: boolean; target?: boolean; readingDefault?: boolean }) => {},
    commitAllStaged: async () => {},
    clearFileCmp: () => {},
    openInsert: (_q?: string, _atPos?: number) => {},
    openExternalFile: async (_p: string, _fromLink?: boolean) => {},
    menu: (_id: string) => {},
  });

  /** 新功能的编辑器扩展（features.ts）：只建一次，回调经由 featureHooks 换成最新的 */
  const featureHooks = useRef<FeatureHooks>({});
  featureHooks.current.env = { typewriter: () => sRef.current.typewriter, paraFocus: () => sRef.current.paraFocus };
  featureHooks.current.slash = { run: (id) => bridge.current.menu(id) };
  const extra = useMemo(() => features(featureHooks), []);

  /** 提示条。kind 决定前面小圆点的颜色：success 绿、warn 琥珀、error 红，info 不带点；第二个参数也可以直接给操作（普通提示） */
  const say: SayFn = useCallback((m, kind = "info", action) => {
    if (typeof kind !== "string") { action = kind; kind = "info"; }
    const actions = !action ? [] : Array.isArray(action) ? action : [action];
    setToast({ msg: m, kind, actions });
    window.clearTimeout((say as unknown as { t: number }).t);
    (say as unknown as { t: number }).t = window.setTimeout(() => setToast(null), actions.length ? 6000 : 2600);
  }, []);

  useEffect(() => { setNotifier(say); }, [say]);

  /* ---------- 设置、主题与焦点恢复 ---------- */
  const sRef = useRef(s);
  sRef.current = s;
  // 打字机滚动、段落聚焦开关变了：让编辑器马上重算一次
  useEffect(() => { view()?.dispatch({}); }, [s.paraFocus, s.typewriter]); // eslint-disable-line react-hooks/exhaustive-deps
  const update = (p: Partial<Settings>) => setS((old) => { const n = { ...old, ...p }; saveSettings(n); return n; });

  // 批注署名：设置里填的；第一次启动时还空着，用系统用户名填上（浏览器预览里拿不到，留空，显示成「我」）
  setNoteAuthor(s.noteAuthor);
  useEffect(() => {
    if (!be || s.noteAuthor) return;
    be.userName().then((n) => { if (n) update({ noteAuthor: n }); }).catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [be]);

  // 对话框（搜索、导出、设置……）关掉后，把焦点和原来的光标位置还给正文（H16）
  const prevDlg = useRef<DlgKind>(null);
  useEffect(() => {
    const was = prevDlg.current;
    prevDlg.current = dlg;
    if (was && !dlg && path) requestAnimationFrame(() => { if (![...document.querySelectorAll(".scrim, .menu, .ins")].some((e) => !e.closest(".leaving"))) view()?.focus(); });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dlg]);

  useEffect(() => {
    const r = document.documentElement;
    if (s.theme === "system") delete r.dataset.theme; else r.dataset.theme = s.theme;
  }, [s.theme]);
  useEffect(() => {
    const mq = matchMedia("(prefers-color-scheme: dark)");
    const f = () => applyAccent(s.accent, s.theme === "dark" || (s.theme === "system" && mq.matches));
    f();
    mq.addEventListener("change", f);
    return () => mq.removeEventListener("change", f);
  }, [s.accent, s.theme]);

  useEffect(() => { getBackend().then(setBe); }, []);
  useEffect(() => { be?.listFonts().then(setFonts).catch(() => setFonts([])); }, [be]);

  /* ---------- 派生数据、大纲滚动与编辑器预览选项 ---------- */
  const layout = useMemo(() => docLayout(text), [text]);
  const notes = useMemo<Note[]>(() => parseNotes(text), [text]);
  const hs = useMemo(() => headings(text), [text]);
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

  const count = useCallback((t: string, p: boolean) => countWords(t, p), []);
  const totalCounter = useMemo(wordCounter, []);
  const total = useMemo(() => totalCounter(text, s.countPunct), [totalCounter, text, s.countPunct]);
  const stats = useMemo(() => {
    const secs = hs.filter((h) => h.level <= 2);
    const cur = [...secs].reverse().find((h) => h.pos <= cursor);
    // 光标在第一个标题之前（比如刚打开文件）时没有「本节」，状态栏不显示
    if (!cur) return { total, sec: -1 };
    const next = secs.find((h) => h.pos > cur.pos);
    const sec = countWords(plainText(text.slice(cur.pos, next ? next.pos : undefined)), s.countPunct);
    return { total, sec };
  }, [total, text, hs, cursor, s.countPunct]);

  const bibMap = useMemo(() => new Map(bib.map((b) => [b.key, b])), [bib]);
  /** 用默认程序打开本机文件（非 Markdown） */
  function openOther(abs: string) {
    if (!be) return;
    if (be.isDemo) { say("浏览器预览里打不开本机文件，桌面版会用默认程序打开", "info"); return; }
    be.openPath(abs).catch((e) => say(reason(e, "没能打开这个文件"), "error"));
  }

  const fileHooksRef = useRef<{ view: (abs: string) => void; open: (abs: string) => void; reveal: (abs: string) => void }>({ view: () => {}, open: () => {}, reveal: () => {} });
  const linkRef = useRef<LinkHooks>({ docPath: () => "", openUrl: () => {}, openFile: () => {}, jump: () => false });

  /** 编辑器的预览选项；docPath 是解析图片、文件链接用的文稿路径（正文用当前文稿，并排参考用参考的文件，N20） */
  const makePreview = (docPath: () => string): PreviewOptions => ({
    syntax: () => s.syntax,
    citeLabel: (keys: string[]) => citeText(keys, bibMap),
    citeInfo: (k: string) => bibMap.get(k),
    resolveImage: (src: string) => {
      if (/^(https?:|data:)/.test(src)) return src;
      let raw = src.replace(/^<(.*)>$/, "$1");
      try { raw = decodeURI(raw); } catch { /* 原样使用 */ }
      const abs = /^(\/|[A-Za-z]:[\\/])/.test(raw) ? toPosix(raw) : normalize(join(dirOf(docPath()), raw));
      if (!isTauri && demoImages.has(abs)) return demoImages.get(abs)!;
      if (isTauri) return (window as unknown as { __TAURI_INTERNALS__: { convertFileSrc: (p: string) => string } }).__TAURI_INTERNALS__.convertFileSrc(abs);
      return abs;
    },
    files: {
      resolve: (src: string) => {
        let raw = src.replace(/^<(.*)>$/, "$1");
        try { raw = decodeURI(raw); } catch { /* 原样使用 */ }
        return /^(\/|[A-Za-z]:[\\/])/.test(raw) ? toPosix(raw) : normalize(join(dirOf(docPath()), raw));
      },
      url: (abs: string) => (be ? be.fileUrl(abs) : abs),
      preview: (abs: string) => (be ? be.filePreview(abs) : Promise.reject(new Error("no backend"))),
      view: (abs: string) => fileHooksRef.current.view(abs),
      open: (abs: string) => fileHooksRef.current.open(abs),
      reveal: (abs: string) => fileHooksRef.current.reveal(abs),
      repick: async () => {
        if (!be || be.isDemo) { say("浏览器预览里不能选择本机文件", "info"); return null; }
        const p = await be.pickFile("重新选择文件");
        return p ? relative(dirOf(docPath()), p) : null;
      },
    },
    onAtCite: (pos: number) => { bridge.current.openInsert("@", pos); return true; },
    // 打开链接只有一个入口（editor/links.ts 的 openLink）：编辑时 ⌘ 点击、阅读模式单击都走这里
    links: {
      docPath: () => live.current.path,
      openUrl: (url: string) => linkRef.current.openUrl(url),
      openFile: (abs: string, md: boolean, anchor?: string) => linkRef.current.openFile(abs, md, anchor),
      jump: (id: string) => linkRef.current.jump!(id),
    },
  });
  const preview = useMemo(() => makePreview(() => live.current.path), [s.syntax, bibMap, be]); // eslint-disable-line react-hooks/exhaustive-deps
  const refPreview = useMemo(() => (dp: () => string): PreviewOptions => ({ ...makePreview(dp), onAtCite: undefined, links: undefined }), [s.syntax, bibMap, be]); // eslint-disable-line react-hooks/exhaustive-deps
  const resolveImage = useCallback((src: string) => preview.resolveImage(src), [preview]);
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

  /* ---------- 新功能模块 ---------- */
  const openSettings = (pane?: Pane) => { setSettingsPane(pane); setDlg("settings"); };
  const treeOrder = useTreeOrder(be, root, tree);
  const showPanelRef = useRef(showPanel);
  showPanelRef.current = showPanel;
  const refPane = useRefPane(root, tree, { hide: () => { const was = showPanelRef.current; if (was) setShowPanel(false); return was; }, restore: () => setShowPanel(true) });
  const wstats = useWritingStats({ be, tree, livePath: () => live.current.path, liveText: () => live.current.text, withPunct: s.countPunct });
  const symbols = useSymbols(view);
  featureHooks.current.withPunct = () => s.countPunct;
  const spots = useRememberSpot(view, () => scroller.current);
  useSpotAutosave(spots.capture, useCallback(() => live.current.path, []));
  const reading = useReading({
    view, be, livePath: () => live.current.path, resolveImage, bib: bibMap, say,
    followLink: (href) => { openLink(href, linkRef.current); },
  });
  featureHooks.current.reading = reading.hooks;
  const nav = useNav({ view, livePath: () => live.current.path, open: (p) => bridge.current.openFile(p, { target: true }) });
  const tidy = useTidy({ view, rules: s.tidy, text, say, openSettings: () => openSettings("tidy") });

  /* ---------- 领域 hooks：版本、文档读写、工作区、插入与拖放、命令 ---------- */
  const ver = useVersions({
    be, path, text, dlg, setDlg, live, ed, view, setText,
    flush: () => bridge.current.flush(),
    say,
  });

  const doc = useDocument({
    be, s, path, setPath, setText, setViewing, setScrollHeading, setDlg, live, ed, scroller, view,
    layout, bibMap, resolveImage, readingOn: reading.on, cmpActive: !!ver.cmp,
    setVersions: ver.setVersions, setFresh: ver.setFresh,
    clearCompare: () => { ver.setCmp(null); bridge.current.clearFileCmp(); },
    commitCheckpoint: ver.commitCheckpoint,
    commitAllStaged: () => bridge.current.commitAllStaged(),
    onOpenSpot: (p, opts) => {
      const spot = opts?.target ? null : spots.recall(p);
      reading.afterLoad(p, opts?.reading ?? spot?.reading ?? opts?.readingDefault);
      if (spot) spots.restore(spot);
    },
    onCaptureSpot: spots.capture,
    onStatsOpen: wstats.noteOpen,
    onStatsSave: wstats.noteSave,
    say,
  });

  const ws = useWorkspace({
    be, s, update, root, setRoot, single, setSingle, tree, setTree, path, setPath, text, setText, setBib,
    dlg, setDlg, live, ed, view, flush: doc.flush, openFile: doc.openFile, openOther,
    setVersions: ver.setVersions, clearVersionCmp: () => ver.setCmp(null),
    onCaptureSpot: spots.capture,
    onPathMoved: (from, to) => { treeOrder.renamed(from, to); wstats.noteMove(from, to); spots.move(from, to); nav.rename(from, to); },
    onPathRemoved: (p) => { nav.rename(p, null); },
    treeOrder, openRefPane: refPane.open, say,
  });

  const insDrop = useInsertAndDrop({
    be, root, path, s, view, scroller,
    insertAtCursor: doc.insertAtCursor,
    openExternalFile: ws.openExternalFile,
    say,
  });

  /** 跳到某个位置，并把它滚到顶部（不是刚好露出在底部） */
  function jump(pos: number, rec = true) {
    const v = view(); if (!v) return;
    if (rec) nav.record();
    ver.setCmp(null);
    const at = Math.min(pos, v.state.doc.length);
    const hi = hs.findIndex((h) => h.pos === pos);
    if (hi >= 0) { setScrollHeading(hi); lockHeading.current = Date.now() + 900; }
    v.dispatch({ selection: { anchor: at }, effects: EditorView.scrollIntoView(at, { y: "start", yMargin: 28 }) });
    v.focus();
  }
  /** 搜索结果：选中匹配的文字并滚到屏幕中间 */
  function jumpTo(pos: number, len: number, rec = true) {
    const v = view(); if (!v) return;
    if (rec) nav.record();
    ver.setCmp(null); ws.setFileCmp(null);
    const at = Math.min(pos, v.state.doc.length);
    v.dispatch({ selection: { anchor: at, head: Math.min(at + len, v.state.doc.length) }, effects: EditorView.scrollIntoView(at, { y: "center" }) });
    v.focus();
  }
  async function openAt(p: string, pos: number, len: number) {
    nav.record();
    if (p !== live.current.path) await doc.openFile(p, { target: true });
    requestAnimationFrame(() => jumpTo(pos, len, false));
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
      if (root && isInside(root, abs)) await doc.openFile(abs, { reading: keepReading, target: !!anchor });
      else { await ws.openExternalFile(abs, true); if (live.current.path === abs) reading.set(keepReading); }
    }
    if (anchor && live.current.path === abs) requestAnimationFrame(() => jumpAnchor(anchor, false));
  }

  fileHooksRef.current = {
    view: (abs) => {
      if (isMarkdown(abs)) openLinkedMarkdown(abs).catch(() => say("没能打开这个文件", "error"));
      else if (previewKind(abs) !== "other") setViewing(abs);
      else openOther(abs);
    },
    open: (abs) => { if (isMarkdown(abs)) openLinkedMarkdown(abs).catch(() => say("没能打开这个文件", "error")); else openOther(abs); },
    reveal: (abs) => { be?.reveal(abs).catch(() => {}); },
  };
  linkRef.current = {
    docPath: () => live.current.path,
    openUrl: (url) => { if (be) be.openUrl(url).catch((e) => say(reason(e, "没能打开这个链接"), "error")); },
    openFile: (abs, md, anchor) => { if (md) openLinkedMarkdown(abs, anchor).catch(() => say("没能打开这个文件", "error")); else openOther(abs); },
    jump: (id) => jumpAnchor(id),
  };

  async function openExport() {
    if (!path) return;
    await doc.flush().catch(() => null);
    ws.setBatch(null);
    setDlg("export");
  }

  const cmds = useCommands({
    be, s, sRef, update, root, single, path, viewing, setViewing, dlg, setDlg, setReplaceQ,
    focus, setFocus, setTab, toggleSide, togglePanel, openPanel, openSettings, openExport,
    ed, view, hs, jump, readingOn: reading.on, toggleReading: reading.toggle,
    navCanBack: nav.canBack, navCanForward: nav.canForward, navBack: nav.back, navForward: nav.forward,
    refPanePath: refPane.path, closeRefPane: refPane.close,
    openTidy: tidy.open, openSymbols: symbols.open, copyFormatted: doc.copyFormatted,
    newFile: ws.newFile, chooseFolder: ws.chooseFolder, closeFolder: ws.closeFolder,
    checkpoint: ver.checkpoint, openInsert: insDrop.openInsert, pickImage: doc.pickImage,
    importDocx: ws.importDocx, requestClose: doc.requestClose,
    hasCmp: !!(ver.cmp || ws.fileCmp),
    clearCompare: () => { ver.setCmp(null); ws.setFileCmp(null); },
    say,
  });

  bridge.current = {
    flush: doc.flush,
    openFile: doc.openFile,
    commitAllStaged: ws.commitAllStaged,
    clearFileCmp: () => ws.setFileCmp(null),
    openInsert: insDrop.openInsert,
    openExternalFile: ws.openExternalFile,
    menu: (id) => cmds.menuRef.current(id),
  };
  // 方便自动化测试读取编辑器状态
  (window as unknown as { __hm: unknown }).__hm = { view, menu: (id: string) => cmds.menuRef.current(id), openExternal: (p: string) => ws.openExternalFile(p) };

  /** 文件树单击：Markdown 打开编辑，其他文件在正文区预览 */
  const openFromTree = (p: string) => {
    if (!/\.(md|markdown)$/i.test(p)) { setViewing(p); return; }
    if (p === live.current.path) { setViewing(""); return; }
    void doc.openFile(p);
  };
  const noSearch = useCallback(() => [] as PaletteItem[], []);
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
        {path && doc.saveState === "error" && <div className="savestate" role="alert" title="自动保存没有成功，继续编辑会再次尝试"><i />保存失败</div>}
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
            <button className={"folder" + (root || single ? "" : " none")} onClick={(e) => { if (!root && !single) { ws.chooseFolder(); return; } const r = e.currentTarget.getBoundingClientRect(); ws.setFolderMenu({ x: r.left + 8, y: r.bottom }); }} title={root ? root : single ? single : "选择的文件夹中的文件会显示在下方"} aria-haspopup="menu">
              <span className="fname">{root ? baseName(root) : single ? <MidName name={stripMd(baseName(single))} tail={6} /> : "打开文件夹"}{(root || single) && <Icon name="chev" size={12} />}</span>
              <span className="fpath">{root ? shortPath(root) : single ? shortPath(dirOf(single)) : "选择的文件夹中的文件会显示在下方"}</span>
            </button>
            {single && !root && <button className="tn single-open" onClick={ws.adoptSingleFolder} title={`打开整个「${baseName(dirOf(single))}」`}>
              <span className="slot"><Icon name="folderOpen" size={14} /></span><span className="nm">打开所在文件夹</span></button>}
            <FileTree nodes={treeOrder.shown} root={root} manual={treeOrder.manual} onReorder={(n, d, b) => { void ws.reorderTree(n, d, b); }} onReference={refPane.open} current={viewing || path} onOpen={openFromTree} onPreview={openFromTree} showAll={s.showAllFiles} renaming={ws.renaming} onRename={ws.renameDone}
              onOpenOther={openOther}
              onStartRename={ws.setRenaming} onDelete={(n) => ws.trash(n)} onMove={(n, d) => ws.moveTo(n, d)}
              onMenu={(e, node) => { if (root) ws.setTreeMenu({ x: e.clientX, y: e.clientY, node }); }} />
          </div>
          {/* Mac 上设置在菜单栏「HolyMark → 设置…」里，左下角不再放 */}
          {!nativeMenu && <div className="side-foot"><button className="tn" onClick={() => setDlg("settings")}><span className="ico"><Icon name="gear" size={14} /></span><span className="nm">设置</span><span className="ext">{kbd("⌘,")}</span></button></div>}
        </div>
      </aside>

      <main className={"main" + (refPane.path ? " has-ref" + (narrow ? " ref-" + refPane.focus : "") : "")} style={refPane.path ? { "--rw": `${refPane.width}px` } as React.CSSProperties : undefined} onMouseDown={() => { if (drawer) setDrawer(null); }}>
        {refPane.path && narrow && <div className="ref-switch"><Segmented label="正文或参考" value={refPane.focus} options={[["doc", "正文"], ["ref", "参考"]]} onChange={refPane.setFocus} /></div>}
        {path && !reading.on && !viewing && <Ribbon view={ed.current?.view() ?? null} author={noteAuthor()} settings={s} fonts={fonts} layout={layout} onLayout={doc.applyLayout}
          collapsed={s.ribbonCollapsed} setCollapsed={(c) => update({ ribbonCollapsed: c })}
          onPickImage={doc.pickImage} onCite={() => insDrop.openInsert()} active={fmt.active} block={fmt.block} onTidy={tidy.open} />}
        <div className="scroller" ref={scroller} onScroll={() => window.requestAnimationFrame(syncScrollHeading)} onMouseDown={doc.clickBelow}>
          <div className="doc">
            {!path && <Welcome hasRoot={!!root} recent={s.recentFolders} onOpen={ws.chooseFolder} onNew={() => ws.newFile()} onRecent={(f) => ws.openFolder(f).catch((e) => { if (String(e).includes("重新选择")) { say(String(e), "warn"); return; } say("这个文件夹已经不在了", "warn"); update({ recentFolders: s.recentFolders.filter((x) => x !== f) }); })} />}
            <div hidden={!path}><Editor ref={ed} initial="" preview={preview} previewKey={previewKey} onChange={doc.onChange} onSelection={onSelection} onImages={doc.insertImages} extra={extra} /></div>
          </div>
        </div>
        {!reading.on && !viewing && <FloatingToolbar view={ed.current?.view() ?? null} tick={tick} author={noteAuthor()} active={fmt.active} />}
        {viewing && be && <FileViewer be={be} path={viewing} onInfo={setViewInfo} say={say} onOpenDefault={openOther} onClose={path ? () => setViewing("") : undefined} />}
        {refPane.path && be && <RefPane key={refPane.path} be={be} path={refPane.path} width={refPane.width} onWidth={refPane.setWidth} onClose={refPane.close} onPath={refPane.open}
          preview={refPreview} openOther={openOther} openUrl={(u) => { be.openUrl(u).catch((e) => say(reason(e, "没能打开这个链接"), "error")); }} say={(m) => say(m)} />}
        {ws.fileCmp && <Compare fileLabel={ws.fileCmp.name} oldText={ws.fileCmp.text} newText={live.current.text} against="current" hasPrev={false} prevLabel=""
          onAgainst={() => {}} onClose={() => ws.setFileCmp(null)} onRestore={() => {}} onPick={() => setDlg("cmpfile")} />}
        {ver.cmp && (
          <Compare version={ver.cmp.v} oldText={ver.cmp.oldText} newText={ver.cmp.newText} against={ver.cmp.against} sameAsNow={ver.cmp.same}
            hasPrev={ver.versions.findIndex((x) => x.id === ver.cmp!.v.id) < ver.versions.length - 1}
            prevLabel={(() => { const p = ver.versions[ver.versions.findIndex((x) => x.id === ver.cmp!.v.id) + 1]; if (!p) return ""; const t = fmtTime(p.at); return `${versionTitle(p)} · ${t.day} ${t.hm}`; })()}
            onAgainst={(a) => ver.openVersion(ver.cmp!.v.id, a)} onClose={() => ver.setCmp(null)} onRestore={ver.restore} onBlock={(k, i) => { void ver.restoreBlock(k, i); }} />
        )}
      </main>

      <aside className="panel" aria-label="当前文件">
        {viewing ? <FileInfo info={viewInfo} path={viewing} /> : <>
        <SidePanel tab={tab} setTab={setTab} headings={hs} currentHeading={scrollHeading} notes={notes} versions={ver.versions} freshVersion={ver.fresh}
          selectedVersion={ver.cmp?.v.id ?? null} fileName={fileName} onJump={jump} onResolve={doc.resolveNote} cursorPos={cursor}
          path={path} readVersion={(p, id) => be ? be.readVersion(p, id) : Promise.resolve("")}
          onAddHeading={() => { const v = view(); if (v) { setBlock(v, "h1"); v.focus(); } }} onAddNote={() => cmds.menuRef.current("note")}
          onOpenVersion={(id) => ver.openVersion(id)} onSaveVersion={() => setDlg("save")} onCompareFile={() => setDlg("cmpfile")}
          canRevert={!!path && text !== live.current.opened} onRevert={ver.revertToOpened}
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
      <Presence>{dlg === "save" && <SaveVersionDialog changes={ver.saveChanges} fileName={fileName} onSave={ver.saveVersion} onClose={() => { setDlg(null); ver.commitCheckpoint().catch(() => {}); }} />}</Presence>
      <Presence>{dlg === "settings" && <SettingsDialog s={s} fonts={fonts} onChange={update} initialPane={settingsPane} onClose={() => setDlg(null)} onReset={() => {
        // 恢复默认设置：最近打开的文件夹、上次的文件夹、批注署名、自定义快捷键这类「记住的东西」保留（快捷键在快捷键页单独恢复）；提示条带撤销
        const before = s;
        const keep = { lastFolder: s.lastFolder, recentFolders: s.recentFolders, noteAuthor: s.noteAuthor, shortcuts: s.shortcuts, v: s.v };
        update({ ...DEFAULTS, ...keep });
        say("已恢复默认设置", "success", { label: "撤销", run: () => update(before) });
      }} />}</Presence>
      <Presence>{(dlg === "help_syntax" || dlg === "help_keys") && <HelpDialog kind={dlg === "help_syntax" ? "syntax" : "keys"} onClose={() => setDlg(null)} />}</Presence>
      <Presence>{dlg === "palette" && <SearchPanel text={live.current.text} path={path} root={root} headings={hs} folderTexts={ws.folderTexts} commands={cmds.commands}
        onJump={jumpTo} onOpenAt={openAt} onClose={() => setDlg(null)} onReplace={root ? (q) => { setReplaceQ(q); setDlg("replace"); } : undefined} />}</Presence>
      <Presence>{dlg === "replace" && <FolderReplace files={ws.replaceFiles} root={root} read={ws.readForReplace} initial={replaceQ} onApply={ws.applyReplace} onClose={() => { setDlg(null); view()?.focus(); }} />}</Presence>
      <Presence ms={100}>{insDrop.insertAt && <InsertFile at={insDrop.insertAt} initialQuery={insDrop.insertAt.q} files={flatten(tree)} docPath={path} root={root} bib={bib} recent={insDrop.recentIns}
        doi={root ? { targets: doiTargets(tree, root), add: async (d, t) => {
          if (!be) throw new Error("还没准备好");
          const r = await addDoiEntry(be, d, t, bib, tree);
          setBib(r.entries);
          if (t.isNew) await ws.refreshTree();
          say(`已把这篇文献加进 ${t.label.replace(/（新建）$/, "")}，引用键 ${r.key}`, "success");
          return r.key;
        } } : undefined}
        onPick={insDrop.pickInsert} onPickOther={() => { insDrop.setInsertAt(null); setTimeout(insDrop.citeOtherFile, 0); }} onDeleteAt={insDrop.insertAt.atPos !== undefined ? insDrop.deleteAt : undefined} onClose={() => { insDrop.setInsertAt(null); view()?.focus(); }} />}</Presence>
      {tidy.node}
      {symbols.node}
      {reading.node}
      <Presence>{dlg === "export" && be && <ExportDialog be={be} path={path} root={root} text={text} tree={tree} bib={bib} fonts={fonts} resolveImage={resolveImage} onClose={() => { setDlg(null); if (ws.batch) ws.refreshTree(); ws.setBatch(null); }} say={say} batch={ws.batch ?? undefined} />}</Presence>
      <Presence>{dlg === "refpick" && <Palette items={flatten(treeOrder.shown).filter((f) => f.path !== path).map((f) => ({ group: "在右侧并排参考", icon: isMarkdown(f.name) ? "doc" : "file", title: root ? relative(root, f.path) : f.name, run: () => refPane.open(f.path) }))}
        search={noSearch} onClose={() => setDlg(null)} placeholder="选一个文件，放在正文右边对照着看" />}</Presence>
      <Presence>{dlg === "cmpfile" && <Palette items={ws.cmpItems} search={noSearch} pinned={ws.cmpPick} onClose={() => setDlg(null)} placeholder="选一篇文稿，和当前文稿左右对比" />}</Presence>
      <Presence>{dlg === "move" && ws.moving && <Palette items={ws.moveItems} search={noSearch} onClose={() => { setDlg(null); ws.setMoving(null); }} placeholder={`把「${ws.moving.name}」移到哪个文件夹`} />}</Presence>
      {ws.treeMenu && <Menu x={ws.treeMenu.x} y={ws.treeMenu.y} items={ws.treeMenuItems(ws.treeMenu.node)} onClose={() => ws.setTreeMenu(null)} />}
      {ws.folderMenu && <Menu x={ws.folderMenu.x} y={ws.folderMenu.y} items={ws.folderMenuItems()} onClose={() => ws.setFolderMenu(null)} minWidth={232} />}
      {insDrop.dropCaret && <div className="dropcaret" style={{ left: insDrop.dropCaret.left, top: insDrop.dropCaret.top, height: insDrop.dropCaret.height }} aria-hidden="true" />}
      <Presence>{toast && <div className={"toast " + toast.kind} role="status">{toast.kind !== "info" && <i aria-hidden="true" />}{toast.msg}{toast.actions.map((a) => <button key={a.label} className="lnk" onClick={() => { a.run(); setToast(null); }}>{a.label}</button>)}</div>}</Presence>
      <TooltipLayer />
    </div>
  );
}
