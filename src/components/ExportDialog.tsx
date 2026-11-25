/**
 * 导出对话框：左边是选项，右边是实时预览（页面 / 配置文件）。
 * 选项没有预设，空着就是“不改”；选了参考文档时，读出来的值会填进字段并标上颜色。
 */
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { Backend, ExportTools, FontFamily, RefStyles, TreeNode } from "../lib/backend";
import type { BibEntry } from "../lib/bib";
import {
  cloneOpts, CN_SIZES, defaultsName, defaultsYaml, docxStyle, DOCX_HINTS, EMPTY, ExportOptions, Fmt, Level, loadSaved, markdownOut,
  normalizeOpts, PAPERS, PDF_DEFAULTS, prepareForPandoc, save, splitArgs, typstTemplate,
} from "../lib/exporting";
import { effective, previewHTML } from "../lib/exportPreview";
import { renderMermaid, svgToPng } from "../lib/mermaidImage";
import { FontSelect, Option, Select } from "./Select";
import { NumberField } from "./NumberField";
import { Icon } from "./Icons";
import { baseName, dirOf, join } from "../lib/paths";

interface Props {
  be: Backend;
  path: string;
  root: string;
  text: string;
  tree: TreeNode[];
  bib: BibEntry[];
  fonts: FontFamily[];
  resolveImage: (src: string) => string;
  onClose: () => void;
  onDone: (msg: string, output?: string) => void;
}

const flatten = (ns: TreeNode[]): TreeNode[] => ns.flatMap((x) => (x.dir ? flatten(x.children) : [x]));
const rel = (root: string, p: string) => (p.startsWith(root + "/") ? p.slice(root.length + 1) : p);

const FMTS: [Fmt, string][] = [["docx", "Word"], ["pdf", "PDF"], ["md", "Markdown"]];
const EXT: Record<Fmt, string> = { docx: "docx", pdf: "pdf", md: "md" };
const LEVELS: [Level, string][] = [["1", "章"], ["2", "节"], ["3", "小节"]];

function Seg<T extends string>({ value, options, onChange, label }: { value: T; options: [T, string][]; onChange: (v: T) => void; label: string }) {
  return (
    <div className="seg" role="radiogroup" aria-label={label}>
      {options.map(([v, l]) => <button key={v} type="button" role="radio" aria-checked={value === v} className={value === v ? "on" : ""} onClick={() => onChange(v)}>{l}</button>)}
    </div>
  );
}

export function ExportDialog({ be, path, root, text, tree, bib, fonts, resolveImage, onClose, onDone }: Props) {
  const saved = useMemo(loadSaved, []);
  const [o, setO] = useState<ExportOptions>(() => saved.last || cloneOpts(EMPTY));
  const [presets, setPresets] = useState(saved.presets);
  const [fromRef, setFromRef] = useState<Set<string>>(new Set());
  const [lv, setLv] = useState<Level>("1");
  const [pv, setPv] = useState<"page" | "yaml">("page");
  const [tools, setTools] = useState<ExportTools | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [naming, setNaming] = useState<string | null>(null);
  const [mermaid, setMermaid] = useState<Map<string, string>>(new Map());

  const docDir = dirOf(path);
  const files = useMemo(() => flatten(tree), [tree]);
  const bibMap = useMemo(() => new Map(bib.map((b) => [b.key, b])), [bib]);
  const prepared = useMemo(() => prepareForPandoc(text, o, docDir), [text, o, docDir]);
  const docTitle = prepared.title || baseName(path).replace(/\.(md|markdown)$/i, "");
  const isMd = o.fmt === "md";

  useEffect(() => { be.exportTools().then(setTools).catch(() => setTools({ pandoc: null, typst: null })); }, [be]);
  // 记住上次的选项
  useEffect(() => { save({ last: o, presets }); }, [o, presets]);

  // Escape 关闭
  useEffect(() => {
    const f = (e: KeyboardEvent) => { if (e.key === "Escape" && !document.querySelector(".select-pop")) { e.stopPropagation(); onClose(); } };
    addEventListener("keydown", f, true);
    return () => removeEventListener("keydown", f, true);
  }, [onClose]);

  // 预览里的图表：按代码缓存
  useEffect(() => {
    let alive = true;
    const todo = prepared.mermaid.filter((c) => !mermaid.has(c));
    if (!todo.length) return;
    (async () => {
      const next = new Map(mermaid);
      for (const c of todo) next.set(c, await renderMermaid(c).catch(() => ""));
      if (alive) setMermaid(next);
    })();
    return () => { alive = false; };
  }, [prepared.mermaid, mermaid]);

  const set = useCallback((patch: Partial<ExportOptions>) => {
    setO((x) => ({ ...x, ...patch }));
    setFromRef((s) => { const n = new Set(s); Object.keys(patch).forEach((k) => n.delete(k)); return n; });
  }, []);
  const setH = (patch: Partial<ExportOptions["H"][Level]>) => {
    setO((x) => ({ ...x, H: { ...x.H, [lv]: { ...x.H[lv], ...patch } } }));
    setFromRef((s) => { const n = new Set(s); Object.keys(patch).forEach((k) => n.delete(`H.${lv}.${k}`)); return n; });
  };

  /* ---------- 参考文档 ---------- */
  async function applyReference(p: string) {
    if (!p) { set({ ref: "" }); setFromRef(new Set()); return; }
    try {
      const r: RefStyles = await be.readReference(p);
      const next = cloneOpts({ ...o, ref: p });
      const filled = new Set<string>();
      const put = (k: keyof ExportOptions, v: string | null | undefined) => { if (v) { (next as unknown as Record<string, string>)[k] = v; filled.add(k); } };
      if (r.pageMm) {
        const [w, h] = r.pageMm.map(Number);
        const named = Object.entries(PAPERS).find(([, [pw, ph]]) => Math.abs(pw - w) < 1.5 && Math.abs(ph - h) < 1.5);
        if (named) put("paper", named[0]); else { put("paper", "custom"); put("pw", String(w)); put("ph", String(h)); }
      }
      (["mt", "mb", "ml", "mr"] as const).forEach((k, i) => put(k, r.marginsCm[i]));
      put("cjk", r.cjk); put("latin", r.latin); put("size", r.size);
      if (r.line) { put("lsMode", r.line[0]); put("ls", r.line[1]); }
      put("indent", r.indent); put("before", r.before); put("after", r.after); put("align", r.align);
      r.headings.slice(0, 3).forEach((h, i) => {
        const l = String(i + 1) as Level;
        const hp = (k: keyof ExportOptions["H"][Level], v: string | null | undefined) => { if (v) { (next.H[l] as unknown as Record<string, string>)[k] = v; filled.add(`H.${l}.${k}`); } };
        hp("font", h.font); hp("size", h.size); hp("bold", h.bold === null || h.bold === undefined ? "" : h.bold ? "1" : "0");
        hp("align", h.align === "center" || h.align === "left" ? h.align : ""); hp("before", h.before); hp("after", h.after);
      });
      setO(next);
      setFromRef(filled);
      setErr("");
    } catch (e) { setErr(String(e)); }
  }
  async function pickReference() {
    const p = await be.pickFile("选择参考文档", ["docx", "dotx"]);
    if (p) await applyReference(p);
  }
  async function pickCsl() {
    const p = await be.pickFile("选择引用样式（.csl）", ["csl"]);
    if (p) set({ csl: p });
  }

  /* ---------- 导出 ---------- */
  const bibFiles = useMemo(() => [...files.filter((f) => f.name.endsWith(".bib")).map((f) => f.path), ...prepared.bibliography], [files, prepared.bibliography]);
  const yaml = useMemo(() => (isMd ? "" : defaultsYaml(o, { bibliography: bibFiles, docDir })), [o, bibFiles, docDir, isMd]);
  const template = useMemo(() => (o.fmt === "pdf" ? typstTemplate(o, docTitle) : ""), [o, docTitle]);
  const missing = o.fmt === "md" || !tools || be.isDemo ? [] : [!tools.pandoc && "Pandoc", o.fmt === "pdf" && !tools.typst && "Typst"].filter(Boolean) as string[];

  async function run() {
    setErr("");
    if (be.isDemo && !isMd) { setErr("浏览器预览里不能导出 Word 和 PDF，请在 HolyMark 应用里导出。"); return; }
    const ext = EXT[o.fmt];
    const stem = baseName(path).replace(/\.(md|markdown)$/i, "");
    let out: string | null;
    if (be.isDemo) out = join(docDir, `${stem}-导出.md`);
    else out = await be.pickSave("导出到", join(docDir, `${stem}${isMd ? "-导出" : ""}.${ext}`), ext);
    if (!out) return;
    if (isMd && out === path) { setErr("不能覆盖正在编辑的文件，换个文件名吧。"); return; }
    setBusy(true);
    try {
      if (isMd) {
        await be.writeText(out, markdownOut(text, o, bibMap));
        onDone(`已导出 ${baseName(out)}`, be.isDemo ? undefined : out);
        return;
      }
      const assets: { name: string; data: string }[] = [];
      for (let i = 0; i < prepared.mermaid.length; i++) {
        const svg = mermaid.get(prepared.mermaid[i]) || (await renderMermaid(prepared.mermaid[i]).catch(() => ""));
        if (svg) assets.push({ name: `mermaid-${i + 1}.png`, data: await svgToPng(svg, 3) });
      }
      const r = await be.exportRun({
        format: o.fmt as "docx" | "pdf", markdown: prepared.markdown, output: out,
        defaultsDir: join(root || docDir, ".holymark/export"), defaultsName: defaultsName(o.fmt), defaultsYaml: yaml,
        referenceDoc: o.fmt === "docx" && o.ref ? o.ref : null,
        docxStyle: o.fmt === "docx" ? docxStyle(o, docTitle) : null,
        typstTemplate: o.fmt === "pdf" ? template : null,
        assets, extraArgs: splitArgs(o.extra),
      });
      onDone(`已导出 ${baseName(r.output)}${r.warnings ? "（有提示，见导出窗口）" : ""}`, r.output);
      if (r.warnings) console.warn(r.warnings);
    } catch (e) {
      setErr(String(e));
    } finally { setBusy(false); }
  }

  const pvImage = useCallback((src: string) => {
    const m = src.match(/^hm-asset:mermaid-(\d+)\.png$/);
    if (m) { const svg = mermaid.get(prepared.mermaid[+m[1] - 1]); return svg ? "data:image/svg+xml;charset=utf-8," + encodeURIComponent(svg) : ""; }
    return resolveImage(src);
  }, [mermaid, prepared.mermaid, resolveImage]);

  /* ---------- 字段 ---------- */
  const D = o.fmt === "pdf" ? PDF_DEFAULTS : DOCX_HINTS;
  const hint = (k: keyof typeof DOCX_HINTS & keyof typeof PDF_DEFAULTS) => String(D[k]);
  const xf = (k: string, node: React.ReactNode) => <span className={"xf" + (fromRef.has(k) ? " from" : "")} title={fromRef.has(k) ? "来自参考文档" : undefined}>{node}</span>;
  const numf = (k: "mt" | "mb" | "ml" | "mr" | "indent" | "before" | "after" | "pw" | "ph", label: string, attrs: { min: number; max: number; step?: number }, unit?: string, ph?: string) =>
    xf(k, <NumberField value={o[k]} placeholder={ph ?? (k in D ? String((D as Record<string, unknown>)[k]) : "")} {...attrs} unit={unit} ariaLabel={label} onCommit={(v) => set({ [k]: v })} />);
  const sizeOpts = (dflt: string): Option<string>[] => [
    { value: "", label: `默认（${dflt} pt）` },
    ...CN_SIZES.map(([v, l]) => ({ value: v, label: l, hint: `${v} pt` })),
    ...["8", "9", "10", "11", "12", "13", "14", "16", "18", "20", "24", "28", "32"].filter((v) => !CN_SIZES.some(([x]) => x === v)).map((v) => ({ value: v, label: `${v} pt` })),
  ];
  const withCustom = (opts: Option<string>[], v: string) => (v && !opts.some((x) => x.value === v) ? [...opts, { value: v, label: `${v} pt` }] : opts);
  const fontDefault = (k: "cjk" | "latin") => (o.fmt === "pdf" ? `默认（${k === "cjk" ? PDF_DEFAULTS.cjk : PDF_DEFAULTS.latin}）` : o.ref ? "参考文档里的字体" : "Word 默认字体");

  const refFiles = files.filter((f) => /\.(docx|dotx)$/i.test(f.name) && !f.name.startsWith("~$"));
  const refOptions: Option<string>[] = [
    { value: "", label: "不使用（Pandoc 默认样式）" },
    ...refFiles.map((f) => ({ value: f.path, label: rel(root, f.path), group: "文件夹里的 Word 文件" })),
    ...(o.ref && !refFiles.some((f) => f.path === o.ref) ? [{ value: o.ref, label: baseName(o.ref), hint: dirOf(o.ref), group: "其他位置" }] : []),
    { value: "__pick", label: "选择其他文件…", group: "其他位置" },
  ];
  const cslFiles = files.filter((f) => f.name.endsWith(".csl"));
  const cslOptions: Option<string>[] = [
    { value: "", label: "默认（Chicago 作者-年份）" },
    ...cslFiles.map((f) => ({ value: f.path, label: rel(root, f.path), group: "文件夹里的样式" })),
    ...(o.csl && !cslFiles.some((f) => f.path === o.csl) ? [{ value: o.csl, label: baseName(o.csl), group: "其他位置" }] : []),
    { value: "__pick", label: "选择 .csl 文件…", group: "其他位置" },
  ];
  const H = o.H[lv];
  const hk = (k: string) => `H.${lv}.${k}`;

  const pages = (
    <>
      {o.fmt === "docx" && <div className="og"><h5>参考文档</h5>
        <div className="orow"><span>样式来源</span><Select value={o.ref} options={refOptions} ariaLabel="参考文档" width={300}
          onChange={(v) => (v === "__pick" ? pickReference() : applyReference(v))} /></div>
        <p className="dnote">选了参考文档，会读出它的字体、字号、页边距填进下面（带颜色的字段）；没填的项沿用参考文档。</p>
      </div>}
      <div className="og"><h5>页面</h5>
        <div className="orow"><span>纸张</span>{xf("paper", <Select value={o.paper} ariaLabel="纸张" onChange={(v) => set({ paper: v as ExportOptions["paper"] })}
          options={[{ value: "", label: `默认（${D.paper}）` }, ...Object.keys(PAPERS).map((k) => ({ value: k, label: k === "16K" ? "16 开" : k, hint: `${PAPERS[k][0]}×${PAPERS[k][1]} mm` })), { value: "custom", label: "自定义尺寸" }]} />)}</div>
        {o.paper === "custom" && <div className="orow"><span>宽 × 高</span><div className="pair">{numf("pw", "宽", { min: 50, max: 1000 }, "mm", "210")}{numf("ph", "高", { min: 50, max: 1000 }, "mm", "297")}</div></div>}
        <div className="orow top"><span>页边距<small>厘米</small></span><div className="quad">
          {(["mt", "mb", "ml", "mr"] as const).map((k, i) => <label key={k}><small>{"上下左右"[i]}</small>{numf(k, `${"上下左右"[i]}边距`, { min: 0, max: 10, step: 0.1 })}</label>)}
        </div></div>
        <div className="orow"><span>页眉</span><div className="pair"><input className="tin" value={o.header} placeholder="不显示" aria-label="页眉" onChange={(e) => set({ header: e.target.value })} />
          <Seg label="页眉对齐" value={o.headerAlign} options={[["left", "左"], ["center", "中"], ["right", "右"]]} onChange={(v) => set({ headerAlign: v })} /></div></div>
        <div className="orow"><span>页脚</span><div className="pair"><input className="tin" value={o.footer} placeholder="不显示" aria-label="页脚" onChange={(e) => set({ footer: e.target.value })} />
          <Seg label="页脚对齐" value={o.footerAlign} options={[["left", "左"], ["center", "中"], ["right", "右"]]} onChange={(v) => set({ footerAlign: v })} /></div></div>
        <p className="dnote tokens">可以插入 {(["{页码}", "{总页数}", "{标题}"]).map((t) => <button key={t} type="button" className="tok" onClick={() => set({ footer: o.footer + t })} title="加到页脚">{t}</button>)}，例如 第 {"{页码}"} 页 / 共 {"{总页数}"} 页</p>
      </div>
      <div className="og"><h5>正文</h5>
        <div className="orow"><span>中文字体</span>{xf("cjk", <FontSelect value={o.cjk} fonts={fonts} allowDefault defaultLabel={fontDefault("cjk")} ariaLabel="中文字体" onChange={(v) => set({ cjk: v })} />)}</div>
        <div className="orow"><span>西文字体</span>{xf("latin", <FontSelect value={o.latin} fonts={fonts} allowDefault defaultLabel={fontDefault("latin")} ariaLabel="西文字体" onChange={(v) => set({ latin: v })} />)}</div>
        <div className="orow"><span>字号</span>{xf("size", <Select value={o.size} options={withCustom(sizeOpts(hint("size")), o.size)} ariaLabel="字号" onChange={(v) => set({ size: v })} />)}</div>
        <div className="orow"><span>行距</span><div className="pair"><Seg label="行距方式" value={o.lsMode} options={[["multi", "倍数"], ["fixed", "固定值"]]} onChange={(v) => set({ lsMode: v, ls: "" })} />
          {xf("ls", <NumberField value={o.ls} placeholder={o.lsMode === "fixed" ? "20" : hint("ls")} min={o.lsMode === "fixed" ? 6 : 0.5} max={o.lsMode === "fixed" ? 72 : 4} step={o.lsMode === "fixed" ? 1 : 0.05} unit={o.lsMode === "fixed" ? "pt" : "倍"} ariaLabel="行距" onCommit={(v) => set({ ls: v })} />)}</div></div>
        <div className="orow"><span>首行缩进</span>{numf("indent", "首行缩进", { min: 0, max: 8, step: 0.5 }, "字符")}</div>
        <div className="orow"><span>段前 / 段后</span><div className="pair">{numf("before", "段前", { min: 0, max: 72, step: 0.5 }, "pt")}{numf("after", "段后", { min: 0, max: 72, step: 0.5 }, "pt")}</div></div>
        <div className="orow"><span>对齐</span>{xf("align", <Seg label="对齐" value={o.align} options={[["", "默认"], ["left", "左对齐"], ["justify", "两端对齐"], ["center", "居中"]]} onChange={(v) => set({ align: v })} />)}</div>
      </div>
      <div className="og"><h5>标题 <Seg label="标题级别" value={lv} options={LEVELS} onChange={setLv} /></h5>
        <div className="orow"><span>字体</span>{xf(hk("font"), <FontSelect value={H.font} fonts={fonts} allowDefault defaultLabel="同正文" ariaLabel="标题字体" onChange={(v) => setH({ font: v })} />)}</div>
        <div className="orow"><span>字号</span>{xf(hk("size"), <Select value={H.size} options={withCustom(sizeOpts(D.H[lv].size), H.size)} ariaLabel="标题字号" onChange={(v) => setH({ size: v })} />)}</div>
        <div className="orow"><span>加粗</span>{xf(hk("bold"), <Seg label="加粗" value={H.bold} options={[["", "默认"], ["1", "加粗"], ["0", "不加粗"]]} onChange={(v) => setH({ bold: v })} />)}</div>
        <div className="orow"><span>对齐</span>{xf(hk("align"), <Seg label="标题对齐" value={H.align} options={[["", "默认"], ["left", "左"], ["center", "居中"]]} onChange={(v) => setH({ align: v })} />)}</div>
        {o.fmt === "docx" && <div className="orow"><span>颜色</span><Seg label="标题颜色" value={H.color} options={[["", "默认"], ["black", "黑色"]]} onChange={(v) => setH({ color: v })} /></div>}
        <div className="orow"><span>段前 / 段后</span><div className="pair">
          {xf(hk("before"), <NumberField value={H.before} placeholder="" min={0} max={72} step={0.5} unit="pt" ariaLabel="标题段前" onCommit={(v) => setH({ before: v })} />)}
          {xf(hk("after"), <NumberField value={H.after} placeholder="" min={0} max={72} step={0.5} unit="pt" ariaLabel="标题段后" onCommit={(v) => setH({ after: v })} />)}</div></div>
        <div className="orow"><span>编号</span><input className="tin" value={H.num} placeholder="保留原文编号" aria-label="标题编号" onChange={(e) => setH({ num: e.target.value })} /></div>
        <p className="dnote">例如 第{"{一}"}章、{"{1}.{2}"}。{"{1}{2}{3}"} 是各级的阿拉伯数字，{"{一}{二}{三}"} 是中文数字；填了以后，原文里写的编号会被替换。</p>
      </div>
      <div className="og"><h5>引用、批注与目录</h5>
        <div className="orow"><span>引用样式</span><Select value={o.csl} options={cslOptions} ariaLabel="引用样式" width={300} onChange={(v) => (v === "__pick" ? pickCsl() : set({ csl: v }))} /></div>
        <p className="dnote">国标 GB/T 7714 等样式可以从 Zotero 样式库下载 .csl 文件放进文件夹。{bibFiles.length ? `文献库：${bibFiles.map((b) => baseName(b)).join("、")}` : "文件夹里没有 .bib 文献库，[@key] 引用不会被处理。"}</p>
        {o.fmt === "docx" && <div className="orow"><span>批注</span><Seg label="批注" value={o.notes} options={[["comment", "转为 Word 批注"], ["drop", "不导出"]]} onChange={(v) => set({ notes: v })} /></div>}
        <div className="orow"><span>目录</span><div className="pair"><button type="button" className={"switch" + (o.toc ? " on" : "")} role="switch" aria-checked={o.toc} aria-label="生成目录" onClick={() => set({ toc: !o.toc })} /><span className="dnote">在正文前生成目录</span></div></div>
      </div>
      <div className="og"><h5>高级</h5>
        <textarea className="xa" value={o.extra} placeholder="额外的 Pandoc 参数，例如 --number-sections" aria-label="额外的 Pandoc 参数" onChange={(e) => set({ extra: e.target.value })} />
      </div>
    </>
  );

  const mdOpts = (
    <div className="og"><h5>Markdown</h5>
      <div className="orow"><span>属性区</span><Seg label="属性区" value={o.mdFm} options={[["keep", "保留"], ["drop", "去掉"]]} onChange={(v) => set({ mdFm: v })} /></div>
      <div className="orow"><span>批注</span><Seg label="批注" value={o.mdNotes} options={[["keep", "保留标记"], ["drop", "去掉，只留原文"]]} onChange={(v) => set({ mdNotes: v })} /></div>
      <div className="orow"><span>文献引用</span><Seg label="文献引用" value={o.mdCite} options={[["keep", "保留 [@key]"], ["text", "转为（作者，年份）"]]} onChange={(v) => set({ mdCite: v })} /></div>
      <p className="dnote">图片保持原来的相对路径；导出到别的文件夹时，记得一起拷贝图片。</p>
    </div>
  );

  return (
    <div className="scrim center" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="xdlg" role="dialog" aria-label="导出">
        <div className="xh">
          <h3>导出「{docTitle}」</h3>
          <Seg label="格式" value={o.fmt} options={FMTS} onChange={(f) => { setErr(""); setO((x) => ({ ...x, fmt: f })); }} />
          <div className="xpre">
            {naming === null ? <>
              <Select value="" placeholder="预设" ariaLabel="预设" width={200}
                options={[{ value: "", label: presets.length ? "选择预设…" : "还没有预设" }, ...presets.map((p, i) => ({ value: String(i), label: p.name }))]}
                onChange={(v) => { const p = presets[+v]; if (v && p) { setO(normalizeOpts({ ...p.opts, fmt: o.fmt })); setFromRef(new Set()); } }} />
              <button type="button" className="btn sm" onClick={() => setNaming("")}>存为预设</button>
            </> : <form className="pair" onSubmit={(e) => { e.preventDefault(); const nm = naming.trim(); if (!nm) return; setPresets([...presets.filter((p) => p.name !== nm), { name: nm, opts: cloneOpts(o) }]); setNaming(null); }}>
              <input className="tin" autoFocus placeholder="预设名称" aria-label="预设名称" value={naming} onChange={(e) => setNaming(e.target.value)} />
              <button type="submit" className="btn sm acc">保存</button><button type="button" className="btn sm" onClick={() => setNaming(null)}>取消</button>
            </form>}
          </div>
          <button className="ib" onClick={onClose} aria-label="关闭"><Icon name="close" /></button>
        </div>
        <div className="xb">
          <div className="xopts">{isMd ? mdOpts : pages}</div>
          <div className="xpv">
            <div className="pv-top">
              <span className="dnote">{isMd ? "导出后的文件内容" : pv === "page" ? "实时预览 · 分页和字体是近似效果" : "导出时写入文件夹的 .holymark/export/，命令行里也能用"}</span>
              {!isMd && <Seg label="预览方式" value={pv} options={[["page", "页面"], ["yaml", "配置文件"]]} onChange={setPv} />}
            </div>
            {isMd ? <pre className="xsrc">{markdownOut(text, o, bibMap)}</pre>
              : pv === "yaml" ? <div className="xcfg"><div className="fn">{defaultsName(o.fmt)}</div><pre className="xsrc">{yaml}</pre>
                {o.fmt === "pdf" && <><div className="fn">pdf-template.typst</div><pre className="xsrc">{template}</pre></>}
                {o.fmt === "docx" && <p className="dnote">版式写在同目录的 word-reference.docx 里{o.ref ? `（由 ${baseName(o.ref)} 改写）` : "（由 Pandoc 默认参考文档改写）"}。</p>}</div>
                : <Pages text={text} o={o} docDir={docDir} bib={bibMap} title={docTitle} resolveImage={pvImage} />}
          </div>
        </div>
        <div className="xf-foot">
          <span className="xstatus">
            {err ? <span className="xerr" role="alert">{err}</span>
              : be.isDemo && !isMd ? <span>浏览器预览里只能看效果，导出 Word 和 PDF 请在 HolyMark 应用里进行。</span>
              : missing.length ? <span className="xerr">没有找到 {missing.join("、")}。可以在终端运行 <code>brew install {missing.join(" ").toLowerCase()}</code>，装好后重新打开导出窗口。</span>
                : tools && !isMd ? <span>{[tools.pandoc && `Pandoc ${tools.pandoc.version.replace(/^pandoc\s*/i, "")}${tools.pandoc.bundled ? "（内置）" : ""}`, o.fmt === "pdf" && tools.typst && `Typst ${tools.typst.version.replace(/^typst\s*/i, "").split(" ")[0]}${tools.typst.bundled ? "（内置）" : ""}`].filter(Boolean).join(" · ")}</span> : null}
          </span>
          <button type="button" className="btn" onClick={() => { setO(normalizeOpts({ fmt: o.fmt })); setFromRef(new Set()); }}>全部清空</button>
          <button type="button" className="btn" onClick={onClose}>取消</button>
          <button type="button" className="btn acc" disabled={busy || missing.length > 0 || (be.isDemo && !isMd)} onClick={run}>{busy ? "正在导出…" : `导出 .${EXT[o.fmt]}`}</button>
        </div>
      </div>
    </div>
  );
}

/* ---------------- 分页预览 ---------------- */
function Pages({ text, o, docDir, bib, title, resolveImage }: { text: string; o: ExportOptions; docDir: string; bib: Map<string, BibEntry>; title: string; resolveImage: (s: string) => string }) {
  const box = useRef<HTMLDivElement>(null);
  const flow = useRef<HTMLDivElement>(null);
  const [W, setW] = useState(420);
  const [availH, setAvailH] = useState(600);
  const [page, setPage] = useState(0);
  const [count, setCount] = useState(1);
  const { html, notes } = useMemo(() => previewHTML(text, o, { docDir, bib, resolveImage }), [text, o, docDir, bib, resolveImage]);
  const e = effective(o);
  const showNotes = o.fmt === "docx" && o.notes === "comment" && notes.length > 0;

  useLayoutEffect(() => {
    const el = box.current; if (!el) return;
    const f = () => { setW(el.clientWidth); setAvailH(el.clientHeight); };
    f();
    const ro = new ResizeObserver(f); ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const maxW = Math.max(220, W - 32 - (showNotes ? 170 : 0));
  const width = Math.min(maxW, (availH - 70) * e.pw / e.ph, 520);
  const s = width / e.pw; // 像素 / 毫米
  const pt = 0.3528 * s;
  const height = e.ph * s;
  const [mt, mb, ml, mr] = e.margins.map((c) => c * 10 * s);
  const cw = width - ml - mr, ch = height - mt - mb, gap = 40;

  useLayoutEffect(() => {
    const f = flow.current; if (!f) return;
    const measure = () => { const c = Math.max(1, Math.round((f.scrollWidth + gap) / (cw + gap))); setCount(c); setPage((p) => Math.min(p, c - 1)); };
    measure();
    // 图片、公式加载后再量一次
    const imgs = [...f.querySelectorAll("img")];
    imgs.forEach((i) => i.addEventListener("load", measure, { once: true }));
    return () => imgs.forEach((i) => i.removeEventListener("load", measure));
  }, [html, cw, ch, e.size, e.lineHeight]);

  const tok = (t: string) => t.replace(/\{页码\}/g, String(page + 1)).replace(/\{总页数\}/g, String(count)).replace(/\{标题\}/g, title);
  const flowStyle = {
    height: ch, columnWidth: cw, columnGap: gap, columnFill: "auto", transform: `translateX(${-page * (cw + gap)}px)`,
    fontFamily: e.family, fontSize: e.size * pt, lineHeight: /pt$/.test(e.lineHeight) ? `${parseFloat(e.lineHeight) * pt}px` : e.lineHeight, textAlign: e.align,
    "--pv-indent": `${e.indent}em`, "--pv-before": `${e.before * pt}px`, "--pv-after": `${e.after * pt}px`,
    ...Object.fromEntries(e.heads.flatMap((h, i) => [
      [`--h${i + 1}-size`, `${h.size * pt}px`], [`--h${i + 1}-family`, h.family], [`--h${i + 1}-weight`, String(h.weight)], [`--h${i + 1}-align`, h.align],
      [`--h${i + 1}-before`, `${h.before * pt}px`], [`--h${i + 1}-after`, `${h.after * pt}px`], [`--h${i + 1}-color`, h.color],
    ])),
  } as React.CSSProperties;
  return (
    <div className="pv-area" ref={box}>
      <div className="pv-row">
        <div className="sheet" style={{ width, height }}>
          {o.header.trim() && <div className="hdr" style={{ left: ml, right: mr, top: mt * 0.45, fontSize: 9 * pt, textAlign: o.headerAlign }}>{tok(o.header)}</div>}
          <div className="vp" style={{ left: ml, top: mt, width: cw, height: ch }}>
            <div className={"flow" + (o.fmt === "docx" ? " docx" : "")} ref={flow} style={flowStyle} dangerouslySetInnerHTML={{ __html: html }} />
          </div>
          {o.footer.trim() && <div className="ftr" style={{ left: ml, right: mr, bottom: mb * 0.4, fontSize: 9 * pt, textAlign: o.footerAlign }}>{tok(o.footer)}</div>}
        </div>
        {showNotes && <div className="balloons">{notes.map((x, i) => <div key={i} className="balloon"><b>{x.who}</b>{x.text}</div>)}</div>}
      </div>
      <div className="pv-nav">
        <button type="button" className="btn sm" aria-label="上一页" disabled={page === 0} onClick={() => setPage(page - 1)}><Icon name="back" size={12} /></button>
        <span>第 {page + 1} 页，共 {count} 页</span>
        <button type="button" className="btn sm flip" aria-label="下一页" disabled={page >= count - 1} onClick={() => setPage(page + 1)}><Icon name="back" size={12} /></button>
      </div>
    </div>
  );
}
