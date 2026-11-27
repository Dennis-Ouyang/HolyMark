/**
 * N20 并排参考：正文右边一个只读的参考面板，两边各自滚动。
 * - .md 用阅读模式的渲染（同一个编辑器组件，开着阅读模式：只读、链接单击、图片放大）；
 * - PDF、图片、Word、Excel、PPT 用 N5 的预览（FileViewer）；
 * - 顶部：文件类型图标、文件名、关闭；左边缘可以拖动调整宽度（双击恢复默认）；
 * - 参考里的链接：网页交给浏览器，其他文件用默认程序，另一篇 Markdown 换到参考面板里，#锚点在参考里跳。
 * 打开时右栏自动收起、关掉后恢复；窄窗口时和正文二选一切换（App 管）；按工作区记住上次参考的文件（useRefPane）。
 */
import { useEffect, useMemo, useRef, useState } from "react";
import type { EditorView } from "@codemirror/view";
import { EditorView as EV } from "@codemirror/view";
import { Editor, EditorHandle } from "../editor/Editor";
import type { PreviewOptions } from "../editor/livePreview";
import { readingMode, ReadingHooks, setReading } from "../editor/readingMode";
import { classifyLink, headingPos } from "../editor/links";
import type { Backend } from "../lib/backend";
import { baseName, isMarkdown } from "../lib/paths";
import { FileViewer } from "../components/FileViewer";
import { FileBadge } from "../components/FileBadge";
import { MidName } from "../components/MidName";
import { Icon } from "../components/Icons";
import { Presence } from "../components/Presence";
import { LightImage, Lightbox } from "../components/Lightbox";

interface Props {
  be: Backend;
  path: string;
  width: number;
  onWidth: (w: number) => void;
  onClose: () => void;
  /** 参考面板里换一个文件（参考里点了另一篇 Markdown） */
  onPath: (p: string) => void;
  /** 按参考文件所在的位置解析图片、文献 */
  preview: (docPath: () => string) => PreviewOptions;
  openOther: (abs: string) => void;
  openUrl: (url: string) => void;
  say: (m: string) => void;
}

export const REF_DEFAULT_W = 440;

export function RefPane({ be, path, width, onWidth, onClose, onPath, preview, openOther, openUrl, say }: Props) {
  const md = isMarkdown(path);
  const ed = useRef<EditorHandle>(null);
  const pathRef = useRef(path);
  pathRef.current = path;
  const [box, setBox] = useState<{ images: LightImage[]; index: number; origin: DOMRect } | null>(null);
  const opts = useMemo(() => preview(() => pathRef.current), []); // eslint-disable-line react-hooks/exhaustive-deps
  const hooks = useRef<ReadingHooks>({} as ReadingHooks);
  hooks.current = {
    openImage: (_v, index, images, rect) => setBox({ images: images.map((x) => ({ url: opts.resolveImage(x.src), alt: x.alt })), index, origin: rect }),
    openLink: (href) => {
      const t = classifyLink(href, pathRef.current);
      if (!t) return;
      if (t.kind === "web") openUrl(t.url);
      else if (t.kind === "anchor") jump(t.id);
      else if (t.md) { onPath(t.abs); if (t.anchor) setTimeout(() => jump(t.anchor!), 120); }
      else openOther(t.abs);
    },
    // 参考面板一直是阅读模式，双击不切成编辑
    exitAt: () => {},
  };
  const extra = useMemo(() => [readingMode(() => hooks.current)], []);
  const jump = (id: string) => {
    const v = ed.current?.view(); if (!v) return;
    const p = headingPos(v.state, id);
    if (p === null) { say(`找不到标题「${id}」`); return; }
    v.dispatch({ effects: EV.scrollIntoView(p, { y: "start", yMargin: 24 }) });
  };

  useEffect(() => {
    if (!md) return;
    let dead = false;
    be.readText(path).then((t) => {
      if (dead) return;
      ed.current?.load(t);
      const v = ed.current?.view();
      v?.dispatch({ effects: setReading.of(true) });
      v?.scrollDOM.closest(".ref-body")?.scrollTo({ top: 0 });
    }).catch(() => say("读不到这个文件"));
    return () => { dead = true; };
  }, [be, path, md]); // eslint-disable-line react-hooks/exhaustive-deps

  /* 左边缘拖动调整宽度，双击恢复默认 */
  const drag = (e: React.MouseEvent) => {
    if (e.button !== 0) return;
    e.preventDefault();
    const x0 = e.clientX, w0 = width;
    const el = (e.currentTarget as HTMLElement).closest<HTMLElement>(".refpane");
    let w = w0;
    const mv = (ev: MouseEvent) => {
      w = Math.round(Math.max(280, Math.min(innerWidth * 0.6, w0 + (x0 - ev.clientX))));
      el?.parentElement?.style.setProperty("--rw", w + "px");
    };
    const up = () => { removeEventListener("mousemove", mv); removeEventListener("mouseup", up); document.body.classList.remove("hm-resizing"); onWidth(w); };
    document.body.classList.add("hm-resizing");
    addEventListener("mousemove", mv); addEventListener("mouseup", up);
  };

  return (
    <aside className="refpane" aria-label={`参考：${baseName(path)}`}>
      <div className="ref-grip" onMouseDown={drag} onDoubleClick={() => onWidth(REF_DEFAULT_W)} title={"拖动来调整宽度\nTips：双击可以恢复默认"} role="separator" aria-orientation="vertical" />
      <div className="ref-head">
        <FileBadge name={baseName(path)} />
        <b className="ref-name"><MidName name={md ? baseName(path).replace(/\.(md|markdown)$/i, "") : baseName(path)} tail={8} /></b>
        <span className="tag">参考</span>
        <span className="sp" />
        <button className="ib sm" onClick={onClose} title="关闭并排参考" aria-label="关闭并排参考"><Icon name="close" size={14} /></button>
      </div>
      <div className="ref-body">
        {md ? <div className="ref-doc"><Editor ref={ed} initial="" preview={opts} previewKey="ref" onChange={noop} onSelection={noopView} onImages={noop} extra={extra} /></div>
          : <FileViewer be={be} path={path} onInfo={noop} say={say} onOpenDefault={openOther} />}
      </div>
      <Presence ms={120}>{box && <Lightbox images={box.images} index={box.index} origin={box.origin} onClose={() => setBox(null)} />}</Presence>
    </aside>
  );
}
const noop = () => {};
const noopView = (_v: EditorView) => {};
