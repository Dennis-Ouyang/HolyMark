import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { EditorView } from "@codemirror/view";
import { Editor, EditorHandle } from "./editor/Editor";
import { esc } from "./editor/livePreview";
import { Backend, getBackend, isTauri, TreeNode, VersionMeta } from "./lib/backend";
import { alignBlocks, countWords, docLayout, headings, Note, parseNotes, plainText, setDocLayout } from "./lib/markdown";
import { loadSettings, saveSettings, Settings, fontStack } from "./lib/settings";
import { BibEntry, parseBib, shortAuthor } from "./lib/bib";
import { DEMO_START } from "./lib/demo";
import { FileTree } from "./components/FileTree";
import { FloatingToolbar, Ribbon } from "./components/Toolbars";
import { PanelTab, SidePanel, fmtTime, versionTitle } from "./components/SidePanel";
import { Compare } from "./components/Compare";
import { CountPop, Palette, PaletteItem, SaveVersionDialog, SettingsDialog } from "./components/Dialogs";
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
  const [dlg, setDlg] = useState<null | "save" | "settings" | "palette" | "cite">(null);
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
  const say = useCallback((m: string) => { setToast(m); window.clearTimeout((say as unknown as { t: number }).t); (say as unknown as { t: number }).t = window.setTimeout(() => setToast(null), 2600); }, []);

  /* ---------- settings & theme ---------- */
  const update = (p: Partial<Settings>) => setS((old) => { const n = { ...old, ...p }; saveSettings(n); return n; });
  useEffect(() => {
    const r = document.documentElement;
    if (s.theme === "system") delete r.dataset.theme; else r.dataset.theme = s.theme;
  }, [s.theme]);

  /* ---------- folder & files ---------- */
  useEffect(() => { getBackend().then(setBe); }, []);
  useEffect(() => {
    if (!be) return;
    (async () => {
      const start = be.isDemo ? dirOf(dirOf(DEMO_START)) : s.lastFolder;
      if (start) await openFolder(start, be.isDemo ? DEMO_START : undefined).catch(() => update({ lastFolder: "" }));
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
    // 打开时留一个基线版本，之后的任何修改都能回到这里
    await be.saveVersion(p, content, "auto").catch(() => null);
    setVersions(await be.listVersions(p).catch(() => []));
  }

  /* ---------- editing, autosave, auto versions ---------- */
  const onChange = useCallback((t: string) => {
    live.current.text = t;
    setText(t);
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
      live.current.text = content; live.current.lastWritten = content;
      ed.current?.replace(content);
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
  const currentHeading = useMemo(() => { let c = 0; hs.forEach((h, i) => { if (h.pos <= cursor) c = i; }); return c; }, [hs, cursor]);
  const count = useCallback((t: string, p: boolean) => countWords(t, p), []);
  const stats = useMemo(() => {
    const total = countWords(plainText(text), s.countPunct);
    const secs = hs.filter((h) => h.level <= 2);
    let sec = 0;
    const cur = [...secs].reverse().find((h) => h.pos <= cursor);
    if (cur) { const next = secs.find((h) => h.pos > cur.pos); sec = countWords(plainText(text.slice(cur.pos, next ? next.pos : undefined)), s.countPunct); }
    return { total, sec };
  }, [text, hs, cursor, s.countPunct]);

  const bibMap = useMemo(() => new Map(bib.map((b) => [b.key, b])), [bib]);
  const preview = useMemo(() => ({
    syntax: () => s.syntax,
    citeLabel: (k: string) => { const b = bibMap.get(k); return b ? `${shortAuthor(b.author)}, ${b.year}` : "@" + k; },
    resolveImage: (src: string) => {
      if (/^(https?:|data:)/.test(src)) return src;
      const abs = normalize(dirOf(live.current.path) + "/" + decodeURI(src));
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

  const onSelection = useCallback((v: EditorView) => {
    const r = v.state.selection.main;
    setCursor(r.head);
    setSelText(r.empty ? "" : v.state.sliceDoc(r.from, r.to));
    setTick((t) => t + 1);
  }, []);

  /* ---------- actions ---------- */
  function jump(pos: number) {
    const v = view(); if (!v) return;
    setCmp(null);
    v.dispatch({ selection: { anchor: Math.min(pos, v.state.doc.length) }, scrollIntoView: true });
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
    ed.current?.replace(content);
    live.current.text = content;
    setText(content);
    await flush();
    setVersions(await be.listVersions(path));
    setCmp(null);
    say(`已恢复到「${versionTitle(cmp.v)}」，恢复前的内容已存为版本`);
  }
  async function pickImage() {
    const v = view(); if (!v || !be) return;
    if (isTauri) {
      const { open } = await import("@tauri-apps/plugin-dialog");
      const { invoke } = await import("@tauri-apps/api/core");
      const src = await open({ multiple: false, filters: [{ name: "图片", extensions: ["png", "jpg", "jpeg", "gif", "svg", "webp"] }] });
      if (typeof src !== "string") return;
      const dest = await invoke<string>("copy_into_folder", { src, dir: dirOf(path) + "/assets" });
      const rel = relative(dirOf(path), dest);
      insertAtCursor(`![${baseName(dest).replace(/\.[^.]+$/, "")}](${encodeURI(rel)})`, true);
    } else {
      say("浏览器预览里不能读取本地文件，桌面版会把图片复制到 assets/ 目录");
    }
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
    { group: "命令", icon: "cmd", title: "打开文件夹…", run: chooseFolder },
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
            <FileTree nodes={tree} current={path} onOpen={openFile} />
          </div>
          <div className="side-foot"><button className="tn" onClick={() => setDlg("settings")}><span className="ico"><Icon name="gear" size={14} /></span><span className="nm">设置</span><span className="ext">⌘,</span></button></div>
        </div>
      </aside>

      <main className="main">
        <Ribbon view={ed.current?.view() ?? null} author={AUTHOR} settings={s} layout={layout} onLayout={applyLayout}
          onSaveVersion={() => setDlg("save")} onPickImage={pickImage} onCite={() => setDlg("cite")} />
        <div className="scroller">
          <div className="doc">
            {!path && <div className="welcome"><h2>HolyMark</h2><p>打开一个放稿件的文件夹开始写作。文件就是普通的 Markdown，换任何编辑器都能打开。</p><button className="btn acc" onClick={chooseFolder}>打开文件夹</button></div>}
            <div hidden={!path}><Editor ref={ed} initial="" preview={preview} previewKey={previewKey} onChange={onChange} onSelection={onSelection} /></div>
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
      {dlg === "settings" && <SettingsDialog s={s} onChange={update} onClose={() => setDlg(null)} />}
      {dlg === "palette" && <Palette items={commands} search={search} onClose={() => setDlg(null)} placeholder="搜索全文、文件夹，或输入命令" />}
      {dlg === "cite" && <Palette items={citeItems} search={() => []} onClose={() => setDlg(null)} placeholder="搜索文献或文件，回车插入" />}
      {toast && <div className="toast" role="status"><i />{toast}</div>}
    </div>
  );
}
