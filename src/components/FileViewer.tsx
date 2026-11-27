/**
 * N5 预览非 Markdown 文件：单击文件树里的 PDF、图片、Word、Excel、PPT，在正文区显示只读预览。
 * 当前打开的 Markdown 不受影响（编辑器一直挂着，编辑状态保留），切回去照旧。
 * - PDF：pdf.js，连续滚动、缩放、页码；
 * - 图片：适应窗口或实际大小；
 * - Word、Excel、PPT：Rust 取出的文字和表格（src-tauri/src/preview.rs），排成简单的阅读版式。
 * 右栏的页数、大小、修改时间见 FileInfo。
 */
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { Backend } from "../lib/backend";
import { FileDocument, FilePreview, previewKind } from "../lib/filePreview";
import { fmtDate, fmtSize, middleTruncate } from "../lib/fileInfo";
import { baseName } from "../lib/paths";
import { isWindows } from "../lib/platform";
import { Icon } from "./Icons";
import { Segmented } from "./Segmented";

export function FileViewer({ be, path, onInfo, say }: { be: Backend; path: string; onInfo: (i: FilePreview | null) => void; say: (m: string) => void }) {
  const kind = previewKind(path);
  const name = baseName(path);
  const [pdfBar, setPdfBar] = useState<React.ReactNode>(null);
  const openDefault = () => { if (be.isDemo) say("浏览器预览里打不开本机文件，桌面版会用默认程序打开"); else be.openPath(path).catch(() => say("没能打开这个文件")); };
  const reveal = () => { if (be.isDemo) say("浏览器预览里没有访达"); else be.reveal(path).catch(() => {}); };
  const info = useRef<FilePreview | null>(null);
  const pdfPages = useRef(0);
  useEffect(() => {
    onInfo(null); info.current = null; pdfPages.current = 0;
    be.filePreview(path).then((i) => { info.current = i; onInfo(pdfPages.current ? { ...i, pages: pdfPages.current } : i); }).catch(() => onInfo(null));
  }, [be, path, onInfo]);
  /** PDF 的页数 Rust 不数，pdf.js 打开后补上 */
  const onPages = (n: number) => { pdfPages.current = n; if (info.current) onInfo({ ...info.current, pages: n }); };
  return (
    <div className="fviewer" role="region" aria-label={`预览 ${name}`}>
      <div className="fv-head">
        <Icon name={kind === "pdf" ? "pdf" : kind === "image" ? "img" : /\.xlsx?$/i.test(path) ? "excel" : /\.pptx?$/i.test(path) ? "ppt" : /\.docx?$/i.test(path) ? "word" : "file"} size={16} />
        <b className="fv-name" title={name}>{middleTruncate(name, 40)}</b>
        <span className="tag">只读预览</span>
        <span className="sp" />
        {pdfBar}
        <button className="btn sm" onClick={openDefault}><Icon name="open" size={13} />用默认程序打开</button>
        <button className="btn sm" onClick={reveal}>{isWindows ? "在资源管理器中显示" : "在访达中显示"}</button>
      </div>
      <div className="fv-body">
        {kind === "pdf" && <PdfView url={be.fileUrl(path)} setBar={setPdfBar} onPages={onPages} />}
        {kind === "image" && <ImageView url={be.fileUrl(path)} name={name} />}
        {kind === "office" && <OfficeView be={be} path={path} />}
        {kind === "other" && <div className="fv-empty"><Icon name="file" size={22} /><p>这种文件不能在 HolyMark 里预览</p><button className="btn" onClick={openDefault}>用默认程序打开</button></div>}
      </div>
    </div>
  );
}

/** 右栏：页数、大小、修改时间，三档灰分层 */
export function FileInfo({ info, path }: { info: FilePreview | null; path: string }) {
  const unit = /\.pptx?$/i.test(path) ? "张幻灯片" : /\.xlsx?$/i.test(path) ? "张工作表" : "页";
  return (
    <div className="panel-in finfo">
      <div className="fi-name" title={baseName(path)}>{middleTruncate(baseName(path), 30)}</div>
      {info ? <dl>
        {info.pages ? <><dt>页数</dt><dd className="num">{info.pages} {unit}</dd></> : null}
        <dt>大小</dt><dd className="num">{fmtSize(info.size)}</dd>
        <dt>修改时间</dt><dd className="num t3">{fmtDate(info.modified)}</dd>
      </dl> : <div className="fi-wait">正在读取…</div>}
    </div>
  );
}

function ImageView({ url, name }: { url: string; name: string }) {
  const [mode, setMode] = useState<"fit" | "actual">("fit");
  const [bad, setBad] = useState(false);
  return (
    <div className="fv-image">
      <div className="fv-tools"><Segmented label="图片大小" value={mode} options={[["fit", "适应窗口"], ["actual", "实际大小"]]} onChange={setMode} /></div>
      <div className={"fv-img-wrap " + mode}>
        {bad ? <div className="fv-empty"><Icon name="warn" size={20} /><p>这张图片打不开</p></div> : <img src={url} alt={name} draggable={false} onError={() => setBad(true)} />}
      </div>
    </div>
  );
}

/** PDF：所有页上下排开，滚到附近才画（长文件不卡）；缩放按「适应宽度」的倍数算 */
function PdfView({ url, setBar, onPages }: { url: string; setBar: (n: React.ReactNode) => void; onPages: (n: number) => void }) {
  const box = useRef<HTMLDivElement>(null);
  const [doc, setDoc] = useState<any>(null); // eslint-disable-line @typescript-eslint/no-explicit-any
  const [sizes, setSizes] = useState<{ w: number; h: number }[]>([]);
  const [zoom, setZoom] = useState(1);
  const [width, setWidth] = useState(0);
  const [page, setPage] = useState(1);
  const [err, setErr] = useState("");
  useEffect(() => {
    let dead = false, loaded: any = null; // eslint-disable-line @typescript-eslint/no-explicit-any
    (async () => {
      const pdfjs: any = await import("pdfjs-dist/legacy/build/pdf"); // eslint-disable-line @typescript-eslint/no-explicit-any
      pdfjs.GlobalWorkerOptions.workerSrc = (await import("pdfjs-dist/legacy/build/pdf.worker.min.js?url")).default;
      const data = new Uint8Array(await (await fetch(url)).arrayBuffer());
      loaded = await pdfjs.getDocument({ data, isEvalSupported: false }).promise;
      const s: { w: number; h: number }[] = [];
      for (let i = 1; i <= loaded.numPages; i++) { const v = (await loaded.getPage(i)).getViewport({ scale: 1 }); s.push({ w: v.width, h: v.height }); }
      if (dead) { loaded.destroy(); return; }
      setSizes(s); setDoc(loaded); onPages(loaded.numPages);
    })().catch(() => { if (!dead) setErr("这份 PDF 打不开"); });
    return () => { dead = true; loaded?.destroy(); };
  }, [url]);
  useLayoutEffect(() => {
    const el = box.current; if (!el) return;
    const ro = new ResizeObserver(() => setWidth(el.clientWidth));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const fit = sizes.length ? Math.max(0.2, (Math.min(width, 980) - 48) / Math.max(...sizes.map((s) => s.w))) : 1;
  const scale = fit * zoom;
  // 页码跟着滚动
  const onScroll = () => {
    const el = box.current; if (!el) return;
    const mid = el.scrollTop + el.clientHeight / 3;
    let y = 16, p = 1;
    for (let i = 0; i < sizes.length; i++) { const h = Math.round(sizes[i].h * scale) + 16; if (y + h > mid) { p = i + 1; break; } y += h; p = i + 1; }
    setPage(p);
  };
  useEffect(() => {
    setBar(doc ? <span className="fv-pdfbar">
      <span className="num t3">{page} / {sizes.length}</span>
      <button className="ib sm" aria-label="缩小" disabled={zoom <= 0.5} onClick={() => setZoom((z) => Math.max(0.5, +(z - 0.25).toFixed(2)))}><Icon name="zoomout" size={14} /></button>
      <button className="ib sm fv-zoom num" title="适应宽度" onClick={() => setZoom(1)}>{Math.round(scale * 100)}%</button>
      <button className="ib sm" aria-label="放大" disabled={zoom >= 3} onClick={() => setZoom((z) => Math.min(3, +(z + 0.25).toFixed(2)))}><Icon name="zoomin" size={14} /></button>
    </span> : null);
    return () => setBar(null);
  }, [doc, page, zoom, scale, sizes.length, setBar]);
  if (err) return <div className="fv-empty"><Icon name="warn" size={20} /><p>{err}</p></div>;
  return (
    <div className="fv-pdf" ref={box} onScroll={onScroll}>
      {!doc && <div className="fv-wait">正在打开…</div>}
      {doc && sizes.map((s, i) => <PdfPage key={i} doc={doc} n={i + 1} w={Math.round(s.w * scale)} h={Math.round(s.h * scale)} scale={scale} root={box} />)}
    </div>
  );
}

function PdfPage({ doc, n, w, h, scale, root }: { doc: any; n: number; w: number; h: number; scale: number; root: React.RefObject<HTMLDivElement> }) { // eslint-disable-line @typescript-eslint/no-explicit-any
  const ref = useRef<HTMLCanvasElement>(null);
  const [near, setNear] = useState(n <= 2);
  useEffect(() => {
    const el = ref.current; if (!el) return;
    const io = new IntersectionObserver((es) => { if (es.some((e) => e.isIntersecting)) setNear(true); }, { root: root.current, rootMargin: "800px 0px" });
    io.observe(el);
    return () => io.disconnect();
  }, [root]);
  useEffect(() => {
    if (!near) return;
    let task: any = null; // eslint-disable-line @typescript-eslint/no-explicit-any
    (async () => {
      const page = await doc.getPage(n);
      const k = window.devicePixelRatio || 1;
      const vp = page.getViewport({ scale: scale * k });
      const c = ref.current; if (!c) return;
      c.width = Math.round(vp.width); c.height = Math.round(vp.height);
      task = page.render({ canvasContext: c.getContext("2d")!, viewport: vp });
      await task.promise;
    })().catch(() => {});
    return () => task?.cancel?.();
  }, [near, doc, n, scale]);
  return <canvas ref={ref} className="fv-page" style={{ width: w, height: h }} aria-label={`第 ${n} 页`} />;
}

/** Word：段落；Excel：每张工作表一个表格；PPT：每张幻灯片一张卡片 */
function OfficeView({ be, path }: { be: Backend; path: string }) {
  const [doc, setDoc] = useState<FileDocument | null>(null);
  const [err, setErr] = useState("");
  useEffect(() => { setDoc(null); setErr(""); be.fileDocument(path).then(setDoc).catch((e) => setErr(String(e).replace(/^Error:\s*/, ""))); }, [be, path]);
  if (err) return <div className="fv-empty"><Icon name="warn" size={20} /><p>{err}</p></div>;
  if (!doc) return <div className="fv-wait">正在读取…</div>;
  const empty = !doc.sections.some((s) => s.lines.length);
  return (
    <div className="fv-office">
      <div className="fv-col">
        {doc.title && doc.kind !== "excel" && <h1>{doc.title}</h1>}
        {empty && <p className="t3">没有读到文字</p>}
        {doc.kind === "word" && doc.sections.map((s, i) => <div key={i}>{s.lines.map((l, j) => <p key={j}>{l}</p>)}</div>)}
        {doc.kind === "ppt" && doc.sections.map((s, i) => (
          <section key={i} className="fv-slide"><div className="fv-st num">{s.title}</div>{s.lines.map((l, j) => (j === 0 ? <h3 key={j}>{l}</h3> : <p key={j}>{l}</p>))}</section>
        ))}
        {doc.kind === "excel" && doc.sections.map((s, i) => {
          const rows = s.lines.map((l) => l.split("\t"));
          const cols = Math.max(0, ...rows.map((r) => r.length));
          const isNum = (c: number) => rows.slice(1).every((r) => !r[c] || /^-?[\d,.]+%?$/.test(r[c]));
          return (
            <section key={i} className="fv-sheet">
              <h3>{s.title}</h3>
              {rows.length ? <div className="fv-tscroll"><table>
                <thead><tr>{Array.from({ length: cols }, (_, c) => <th key={c} className={isNum(c) ? "r" : ""}>{rows[0][c] ?? ""}</th>)}</tr></thead>
                <tbody>{rows.slice(1).map((r, k) => <tr key={k}>{Array.from({ length: cols }, (_, c) => <td key={c} className={isNum(c) ? "r num" : ""}>{r[c] ?? ""}</td>)}</tr>)}</tbody>
              </table></div> : <p className="t3">空表</p>}
            </section>
          );
        })}
      </div>
    </div>
  );
}
