/**
 * N2 阅读模式的接线：开关（标题栏按钮、⌘⇧R、⌘K 命令）、每篇各自记住、链接单击打开、图片放大、悬停卡片、双击回到编辑。
 * 编辑器那一侧在 src/editor/readingMode.ts。
 */
import { useCallback, useRef, useState } from "react";
import type { EditorView } from "@codemirror/view";
import type { Backend } from "../lib/backend";
import type { BibEntry } from "../lib/bib";
import { isReading, ReadingHooks, setReading } from "../editor/readingMode";
import { Presence } from "../components/Presence";
import { LightImage, Lightbox } from "../components/Lightbox";

interface Ctx {
  view: () => EditorView | null;
  be: Backend | null;
  livePath: () => string;
  resolveImage: (src: string) => string;
  /** 打开链接：和编辑时 ⌘ 点击走同一个入口（App 里的 followLink，见 editor/links.ts） */
  followLink: (href: string) => void;
  bib: Map<string, BibEntry>;
  say: (m: string) => void;
}

export function useReading(ctx: Ctx) {
  /** 每篇是否在阅读模式（N3 会把它存下来） */
  const byPath = useRef(new Map<string, boolean>());
  const [on, setOn] = useState(false);
  const c = useRef(ctx);
  c.current = ctx;

  const set = useCallback((value: boolean) => {
    const v = c.current.view(); if (!v) return;
    if (isReading(v.state) !== value) v.dispatch({ effects: setReading.of(value) });
    if (value) (document.activeElement as HTMLElement | null)?.blur?.();
    const p = c.current.livePath();
    if (p) byPath.current.set(p, value);
    setOn(value);
  }, []);
  const toggle = useCallback(() => { const v = c.current.view(); if (v) set(!isReading(v.state)); }, [set]);
  /** 换了文件（编辑器状态重建）之后：按这篇记住的状态恢复 */
  const afterLoad = useCallback((path: string, force?: boolean) => { set(force ?? byPath.current.get(path) ?? false); }, [set]);
  const remember = useCallback((path: string, value: boolean) => { byPath.current.set(path, value); }, []);

  /* ---------- 图片放大 ---------- */
  const [box, setBox] = useState<{ images: LightImage[]; index: number; origin: DOMRect } | null>(null);

  const hooks: ReadingHooks = {
    openImage: (_v, index, images, rect) => setBox({ images: images.map((x) => ({ url: c.current.resolveImage(x.src), alt: x.alt })), index, origin: rect }),
    openLink: (href) => c.current.followLink(href),
    exitAt: (pos) => {
      const v = c.current.view(); if (!v) return;
      set(false);
      v.focus();
      v.dispatch({ selection: { anchor: Math.min(pos, v.state.doc.length) } });
    },
  };

  const node = <Presence ms={120}>{box && <Lightbox images={box.images} index={box.index} origin={box.origin} onClose={() => setBox(null)} />}</Presence>;
  return { on, toggle, set, afterLoad, remember, hooks, node };
}
