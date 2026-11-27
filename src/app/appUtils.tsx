/** App 外框共用的工具函数、类型和小型外壳组件（Resizer、Welcome）。 */
import { isTauri, TreeNode } from "../lib/backend";
import { baseName, dirOf } from "../lib/paths";
import { isMac, isWindows } from "../lib/platform";
import { Icon } from "../components/Icons";
import type { NoticeAction, NoticeKind } from "../editor/notice";

export type SayFn = (m: string, kind?: NoticeKind | NoticeAction | NoticeAction[], action?: NoticeAction | NoticeAction[]) => void;

export type DlgKind = null | "save" | "settings" | "palette" | "help_syntax" | "help_keys" | "export" | "cmpfile" | "move" | "replace" | "refpick";

export interface LiveDoc {
  path: string;
  text: string;
  /** 上一次“保存”时的内容（打开文件、保存版本、外部修改之后） */
  base: string;
  /** 这次打开时的内容（「还原到刚打开时」回到这里） */
  opened: string;
  lastWritten: string;
  lastVersionAt: number;
  /** 打开后还没存过起点版本。打开时不写盘，第一次真正改动前才存（只看不改的文件夹里不会出现 .holymark/） */
  needBase?: boolean;
}

/** ⌘K 里命令的小图标（没写的用通用图标） */
export const COMMAND_ICON: Record<string, string> = {
  reading: "book", nav_back: "left", nav_forward: "right", fold_all: "chevRight", unfold_all: "chev", fold_h2: "chevRight",
  folder_replace: "replace", tidy: "typography", math_symbols: "symbols", copy_rich: "clip", copy_wechat: "clip",
  typewriter: "typewriter", para_focus: "parafocus", paper_default: "paper", paper_cream: "paper", paper_gray: "paper", close_preview: "doc",
  ref_open: "panel", ref_close: "close",
};

/** macOS 有原生菜单负责快捷键；Windows 和浏览器预览里由前端处理 */
export const nativeMenu = isTauri && isMac;
/** Windows 上不用系统标题栏，窗口按钮自己画 */
export const customFrame = isTauri && isWindows;

/** 后端报错里给人看的那句话（比如「为了安全，HolyMark 不直接打开程序和脚本……」）；不是给人看的就用 fallback */
export function reason(e: unknown, fallback: string) {
  const m = String((e as Error)?.message ?? e ?? "").replace(/^Error:\s*/, "").trim();
  return /[\u4e00-\u9fff]/.test(m) ? m : fallback;
}

export function flatten(nodes: TreeNode[]): TreeNode[] {
  return nodes.flatMap((n) => (n.dir ? flatten(n.children) : [n]));
}

/** 连文件夹一起摊平 */
export function flatten2(nodes: TreeNode[]): TreeNode[] {
  return nodes.flatMap((n) => (n.dir ? [n, ...flatten2(n.children)] : [n]));
}

/** 仅列出所有文件夹 */
export function folderList(nodes: TreeNode[]): TreeNode[] {
  return nodes.flatMap((n) => (n.dir ? [n, ...folderList(n.children)] : []));
}

/** 侧栏里显示的路径：太长时只留后半段 */
export function shortPath(p: string) {
  return p.length > 38 ? "…" + p.slice(-37) : p;
}

/**
 * 侧栏宽度的拖拽线（H9）：拖的时候直接改 CSS 变量（不重画整个应用），松手后记进设置；双击恢复默认宽度。
 */
export function Resizer({ side, value, min, max, def, onChange }: { side: "left" | "right"; value: number; min: number; max: number; def: number; onChange: (w: number) => void }) {
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
  return (
    <div className={"resizer " + side} role="separator" aria-orientation="vertical" aria-label="拖动来调整宽度，双击可以恢复默认" title={"拖动来调整宽度\nTips：双击可以恢复默认"}
      onMouseDown={down} onDoubleClick={() => onChange(def)} />
  );
}

/** 开始页：没有打开文件夹（或文件夹里还没有文稿）时显示 */
export function Welcome({ hasRoot, recent, onOpen, onNew, onRecent }: { hasRoot: boolean; recent: string[]; onOpen: () => void; onNew: () => void; onRecent: (f: string) => void }) {
  return (
    <div className="welcome">
      <h2>HolyMark</h2>
      <p>{hasRoot ? "这个文件夹里还没有 Markdown 文稿。" : "选择一个文件夹来作为工作区……"}</p>
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
