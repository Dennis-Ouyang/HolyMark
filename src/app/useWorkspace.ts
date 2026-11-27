/**
 * 工作区与文件树领域 hook：
 * - 打开/关闭文件夹、单文件打开与采纳、启动自动打开、外部文件事件、.bib 自动刷新（N21）；
 * - 新建文稿（含首标题自动命名 F13）、新建文件夹、重命名、移动、手动排序（N18）、删除与撤销暂存、复制副本；
 * - 批量导出文件夹（G3）、从 Word 导入（G9）、与其他文稿对比、文件夹全文搜索缓存与文件夹替换（N9）；
 * - 文件树右键菜单与顶部文件夹菜单。
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ChangeSet } from "@codemirror/state";
import type { EditorView } from "@codemirror/view";
import type { EditorHandle } from "../editor/Editor";
import { Backend, demoStartFile, TreeNode, VersionMeta } from "../lib/backend";
import { headings } from "../lib/markdown";
import type { Settings } from "../lib/settings";
import { BibEntry, parseBib } from "../lib/bib";
import { sortTree } from "../lib/sortTree";
import { baseName, dirOf, isInside, isMarkdown, relative } from "../lib/paths";
import { isMac, isWindows } from "../lib/platform";
import type { MenuEntry } from "../components/Menu";
import type { PaletteItem } from "../components/Dialogs";
import type { ReplaceItem } from "../components/FolderReplace";
import type { TreeOrder } from "../lib/manualOrder";
import { DlgKind, flatten, flatten2, folderList, LiveDoc, reason, SayFn, shortPath } from "./appUtils";

export interface UseWorkspaceArgs {
  be: Backend | null;
  s: Settings;
  update: (p: Partial<Settings>) => void;
  root: string;
  setRoot: (r: string) => void;
  single: string;
  setSingle: (p: string) => void;
  tree: TreeNode[];
  setTree: (t: TreeNode[]) => void;
  path: string;
  setPath: (p: string) => void;
  text: string;
  setText: (t: string) => void;
  setBib: (b: BibEntry[]) => void;
  dlg: DlgKind;
  setDlg: React.Dispatch<React.SetStateAction<DlgKind>>;
  live: React.MutableRefObject<LiveDoc>;
  ed: React.RefObject<EditorHandle>;
  view: () => EditorView | null;
  flush: () => Promise<void>;
  openFile: (p: string, opts?: { reading?: boolean; target?: boolean; readingDefault?: boolean }) => Promise<void>;
  openOther: (abs: string) => void;
  setVersions: (vs: VersionMeta[]) => void;
  clearVersionCmp: () => void;
  onCaptureSpot: (p: string) => void;
  onPathMoved: (from: string, to: string) => void;
  onPathRemoved: (p: string) => void;
  treeOrder: {
    shown: TreeNode[];
    manual: boolean;
    order: TreeOrder;
    setMode: (m: "name" | "manual") => void;
    reorder: (dir: string, name: string, before: string | null) => void;
    restore: (prev: TreeOrder) => void;
    removed: (p: string) => void;
  };
  openRefPane: (p: string) => void;
  say: SayFn;
}

export function useWorkspace(a: UseWorkspaceArgs) {
  const { be, s, update, root, setRoot, single, setSingle, tree, setTree, path, setPath, text, setText, setBib, dlg, setDlg, live, ed, view, flush, openFile, openOther, setVersions, clearVersionCmp, onCaptureSpot, onPathMoved, onPathRemoved, treeOrder, openRefPane, say } = a;

  /** 和另一个文件对比 */
  const [fileCmp, setFileCmp] = useState<{ name: string; text: string } | null>(null);
  /** 文件树：右键菜单、改名中的路径、移动中的路径 */
  const [treeMenu, setTreeMenu] = useState<{ x: number; y: number; node: TreeNode | null } | null>(null);
  const [folderMenu, setFolderMenu] = useState<{ x: number; y: number } | null>(null);
  const [renaming, setRenaming] = useState<string | null>(null);
  const [moving, setMoving] = useState<TreeNode | null>(null);
  /** 批量导出一个文件夹（G3） */
  const [batch, setBatch] = useState<{ name: string; dir: string; files: { path: string; text: string }[] } | null>(null);

  /** 删除后还没真正移到废纸篓的（提示条消失、或者关窗口时才移） */
  const staged = useRef(new Map<string, number>());
  const commitStaged = (p: string) => { window.clearTimeout(staged.current.get(p)); staged.current.delete(p); be?.commitStaged(p).catch(() => {}); };
  const commitAllStaged = async () => {
    await Promise.all([...staged.current.keys()].map((p) => { window.clearTimeout(staged.current.get(p)); return be?.commitStaged(p).catch(() => {}); }));
    staged.current.clear();
  };
  /** 刚新建的文件夹：改完名再提示 */
  const justCreated = useRef("");
  const trashName = isWindows ? "回收站" : "废纸篓";

  const refreshTree = async () => { if (be && root) setTree(sortTree(await be.listTree(root))); };
  /** 先做后撤销：提示条右边带「撤销」 */
  const undoable = (msg: string, undo: () => Promise<unknown>) => say(msg, "success", { label: "撤销", run: async () => {
    try { await undo(); await refreshTree(); } catch (e) { say(String(e).replace(/^Error:\s*/, ""), "error"); }
  } });

  /** 重新读文件夹里所有的 .bib（打开文件夹时；外部程序改写了文献库时，N21） */
  async function reloadBib(t: TreeNode[]) {
    if (!be) return;
    const bibs = flatten(t).filter((f) => /\.bib$/i.test(f.name));
    setBib((await Promise.all(bibs.map((b) => be.readText(b.path).catch(() => "")))).flatMap(parseBib));
  }

  // Zotero 这类程序改写 .bib 后：重新读文献库，正文里的引用标签跟着刷新（连续写入只读一次）
  const bibTimer = useRef(0);
  const treeRef = useRef(tree);
  treeRef.current = tree;
  useEffect(() => {
    if (!be || !root) return;
    return be.onBibChange(() => {
      window.clearTimeout(bibTimer.current);
      bibTimer.current = window.setTimeout(async () => {
        // 新建的 .bib 也要算进来：先刷新文件树
        const t = await be.listTree(root).catch(() => treeRef.current);
        setTree(sortTree(t));
        await reloadBib(t);
      }, 400);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [be, root]);

  async function openFolder(dir: string, file?: string) {
    if (!be) return;
    const t = await be.openFolder(dir);
    setSingle("");
    setRoot(dir); setTree(sortTree(t)); update({ lastFolder: dir, recentFolders: [dir, ...s.recentFolders.filter((x) => x !== dir)].slice(0, 8) });
    const files = flatten(t);
    await reloadBib(t);
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
    if (live.current.path) onCaptureSpot(live.current.path);
    await flush().catch(() => {});
    try { await be.openSingle(p); } catch (e) { if (!quiet) say(reason(e, "没能打开这个文件"), "warn"); return false; }
    setRoot(""); setSingle(p); setBib([]); clearVersionCmp(); setFileCmp(null);
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

  // 启动时打开待打开的外部文件、演示文件夹或上次打开的文件夹
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

  useEffect(() => {
    if (!be) return;
    return be.onOpenFile(async () => {
      const ps = await be.takePendingOpen();
      if (ps.length) await openExternalFile(ps[ps.length - 1]);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [be, root]);

  async function chooseFolder() {
    if (!be) return;
    const d = await be.pickFolder();
    if (d) await openFolder(d);
  }

  /** 关闭文件夹，回到开始页；下次启动也从开始页开始，直到再打开一个文件夹 */
  async function closeFolder() {
    if (!be || (!root && !single)) return;
    setSingle("");
    onCaptureSpot(live.current.path);
    await flush().catch(() => {});
    await commitAllStaged();
    await be.closeFolder().catch(() => {});
    live.current = { path: "", text: "", base: "", opened: "", lastWritten: "", lastVersionAt: 0 };
    ed.current?.load("");
    setRoot(""); setTree([]); setPath(""); setText(""); setVersions([]); clearVersionCmp(); setFileCmp(null); setBib([]);
    if (root) update({ lastFolder: "" }); // 关掉单独打开的文件时，不忘掉上次的工作区
  }

  /**
   * 新建的文稿在用户手动改名之前，文件名跟着第一个标题走（F13）：标题停止改动 1.2 秒后改文件名，
   * 不弹提示、不进撤销。手动改过名（或移动过）就不再跟。名单记在本机。
   */
  const autoName = useRef<Set<string>>(new Set((() => { try { return JSON.parse(localStorage.getItem("hm-autoname") || "[]"); } catch { return []; } })()));
  const saveAutoName = () => { try { localStorage.setItem("hm-autoname", JSON.stringify([...autoName.current].slice(-50))); } catch { /* 存不了就算了 */ } };
  const autoTimer = useRef(0);

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

  /** 改名、移动之后：正在编辑的文件（或它所在的文件夹）跟着换路径 */
  async function followMove(from: string, to: string) {
    const cur = live.current.path;
    onPathMoved(from, to);
    if (cur === from || cur.startsWith(from + "/")) {
      const np = to + cur.slice(from.length);
      live.current.path = np;
      setPath(np);
      if (be) setVersions(await be.listVersions(np).catch(() => []));
    }
  }

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

  const newFolderToast = (p: string) => undoable(`已新建文件夹「${baseName(p)}」`, () => be!.trashPath(p));

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
      onPathRemoved(node.path);
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
    clearVersionCmp();
    setFileCmp({ name: root && isInside(root, p) ? relative(root, p) : baseName(p), text: t });
  }

  async function compareOther() {
    if (!be) return;
    if (be.isDemo) { say("浏览器预览里不能选择本机文件"); return; }
    const f = await be.pickFile("选择要对比的文稿", ["md", "markdown", "txt"]);
    if (f) await compareWith(f);
  }

  /* ---------- 文件夹全文搜索缓存 & N9 文件夹查找替换 ---------- */
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

  const replaceFiles = useMemo(() => flatten(tree).filter((f) => /\.(md|markdown)$/i.test(f.name)).map((f) => f.path), [tree]);
  const readForReplace = useCallback(async (p: string) => (p === live.current.path ? live.current.text : be ? be.readText(p) : ""), [be, live]);

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

  /* ---------- 菜单项与选择面板列表 ---------- */
  function treeMenuItems(node: TreeNode | null): MenuEntry[] {
    const reveal = isWindows ? "在资源管理器中显示" : "在访达中显示";
    const toggleAll: MenuEntry = {
      label: "显示所有文件",
      icon: s.showAllFiles ? "check" : "",
      hint: s.showAllFiles ? "" : "当前仅 Markdown",
      run: () => update({ showAllFiles: !s.showAllFiles }),
    };
    if (!node) return [
      { label: "新建文稿", icon: "filePlus", hint: "⌘N", run: () => newFile(root) },
      { label: "新建文件夹", icon: "folderPlus", run: () => newFolder(root) },
      { sep: true },
      toggleAll,
      { sep: true },
      { label: reveal, icon: "open", run: () => be?.reveal(root) },
      { label: "刷新", icon: "reset", run: refreshTree },
    ];
    const md = /\.(md|markdown)$/i.test(node.name);
    return [
      ...(node.dir ? [
        { label: "新建文稿", icon: "filePlus", run: () => newFile(node.path) },
        { label: "新建文件夹", icon: "folderPlus", run: () => newFolder(node.path) },
        { label: "导出整个文件夹…", icon: "export", run: () => exportFolder(node) },
        { sep: true } as MenuEntry,
      ] : !md ? [
        { label: "用默认程序打开", icon: "external", run: () => openOther(node.path) },
        { sep: true } as MenuEntry,
      ] : md ? [
        { label: "打开", icon: "doc", run: () => openFile(node.path) },
        ...(node.path !== path && path ? [{ label: "与当前文稿对比", icon: "compare", run: () => compareWith(node.path) }] : []),
        { sep: true } as MenuEntry,
      ] : []),
      ...(!node.dir ? [{ label: "在右侧并排参考", icon: "panel", hint: isMac ? "⌥ 点击" : "Alt+点击", run: () => openRefPane(node.path) }, { sep: true } as MenuEntry] : []),
      { label: "重命名", icon: "edit", run: () => setRenaming(node.path) },
      ...(!node.dir ? [{ label: "创建副本", icon: "copy", run: async () => { if (!be) return; const c = await be.duplicatePath(node.path); await refreshTree(); undoable(`已创建「${baseName(c)}」`, () => be.trashPath(c)); } }] : []),
      { label: "移动到…", icon: "moveTo", run: () => { setMoving(node); setDlg("move"); } },
      { sep: true },
      { label: reveal, icon: "open", run: () => be?.reveal(node.path) },
      { label: "复制路径", icon: "link", run: () => { navigator.clipboard?.writeText(node.path).then(() => say("已复制路径", "success")).catch(() => {}); } },
      { sep: true },
      toggleAll,
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
      { head: "显示范围" } as MenuEntry,
      { label: "仅 Markdown 文稿", icon: s.showAllFiles ? "" : "check", run: () => update({ showAllFiles: false }) },
      { label: "所有文件", icon: s.showAllFiles ? "check" : "", run: () => update({ showAllFiles: true }) },
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

  const moveItems: PaletteItem[] = moving ? [
    { group: "移动到", icon: "folder", title: baseName(root) + "（最外层）", run: () => moveTo(moving, root) },
    ...folderList(tree).filter((d) => d.path !== moving.path && !d.path.startsWith(moving.path + "/") && d.path !== dirOf(moving.path))
      .map((d) => ({ group: "移动到", icon: "folder", title: relative(root, d.path), run: () => moveTo(moving, d.path) })),
  ] : [];

  const cmpItems: PaletteItem[] = flatten(tree).filter((f) => /\.(md|markdown)$/i.test(f.name) && f.path !== path)
    .map((f) => ({ group: "文件夹里的文稿", icon: "doc", title: relative(root, f.path), run: () => compareWith(f.path) }));
  const cmpPick: PaletteItem = { group: "其他位置", icon: "folder", title: "选择其他位置的文件…", sub: "用系统的文件选择窗口", run: () => { setTimeout(compareOther, 0); } };

  return {
    fileCmp, setFileCmp, treeMenu, setTreeMenu, folderMenu, setFolderMenu,
    renaming, setRenaming, moving, setMoving, batch, setBatch,
    commitAllStaged, refreshTree, openFolder, openExternalFile, adoptSingleFolder,
    chooseFolder, closeFolder, newFile, importDocx, renameDone, moveTo, reorderTree, trash,
    folderTexts, replaceFiles, readForReplace, applyReplace,
    treeMenuItems, folderMenuItems, moveItems, cmpItems, cmpPick,
  };
}
