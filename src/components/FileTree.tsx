/**
 * 左侧文件树。
 * - 自然排序（lib/sortTree.ts，H1）；文件夹和文件的图标位一样宽，同一层的名字对齐（H4）；长名字中间截断（F4）。
 * - 键盘（H5）：↑↓ 移动，←→ 折叠展开（或到父项 / 第一个子项），回车打开，F2 改名，Delete 删除（先做后撤销）。
 * - 拖到文件夹上移动，悬停约 600ms 自动展开（H7，useTreeDrag）；拖到空白处移到最外层。右键菜单的「移动到…」照旧。
 * - 手动排序时（N18）：拖到一行的上半 / 下半是放在它前面 / 后面（一条细线），拖到文件夹中间仍是放进去。
 * - Markdown 以外的文件（打开「显示所有文件」时）用类型图标容器区分，单击在 HolyMark 里只读预览（N5），双击用默认程序打开（H8）。
 * - 悬停 Markdown 文稿显示字数（N14，由 TooltipLayer 的 words 来源异步给出）。
 */
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { TreeNode } from "../lib/backend";
import { isMarkdown, stripMd } from "../lib/paths";
import { Icon } from "./Icons";
import { MidName } from "./MidName";
import { FileBadge } from "./FileBadge";
import { useTreeDrag } from "./useTreeDrag";

interface Props {
  nodes: TreeNode[];
  root: string;
  current: string;
  onOpen: (path: string) => void;
  /** 非 Markdown 文件：用默认程序打开 */
  onOpenOther: (path: string) => void;
  /** 非 Markdown 文件：单击在 HolyMark 里只读预览 */
  onPreview: (path: string) => void;
  showAll: boolean;
  /** 正在改名的路径：这一行显示输入框 */
  renaming: string | null;
  onRename: (path: string, name: string | null) => void;
  onStartRename: (path: string) => void;
  onDelete: (node: TreeNode) => void;
  /** 拖放移动：把 node 移到 dir 里 */
  onMove: (node: TreeNode, dir: string) => void;
  /** 右键：node 为 null 表示点在空白处 */
  onMenu: (e: React.MouseEvent, node: TreeNode | null) => void;
  /** 手动排序（N18）：拖动调整顺序，把 node 放进 dir、排在 before 前面（null 是最后） */
  manual?: boolean;
  onReorder?: (node: TreeNode, dir: string, before: string | null) => void;
  /** ⌥ / Alt + 点击文件：在右侧并排参考（N20） */
  onReference?: (path: string) => void;
}

/** 默认只显示 Markdown 文件和含有 Markdown 的文件夹（空文件夹也显示，刚新建的才看得见） */
function onlyMarkdown(nodes: TreeNode[]): TreeNode[] {
  return nodes.flatMap((n) => {
    if (!n.dir) return isMarkdown(n.name) ? [n] : [];
    const kids = onlyMarkdown(n.children);
    return kids.length || !n.children.length ? [{ ...n, children: kids }] : [];
  });
}

interface Row { node: TreeNode; depth: number; parent: string | null }

export function FileTree({ nodes, root, current, onOpen, onOpenOther, onPreview, showAll, renaming, onRename, onStartRename, onDelete, onMove, onMenu, manual, onReorder, onReference }: Props) {
  const shown = useMemo(() => (showAll ? nodes : onlyMarkdown(nodes)), [nodes, showAll]);
  // 展开状态放在树上（键盘要知道哪些行看得见）；最外层的文件夹默认展开
  const [open, setOpen] = useState<Set<string>>(() => new Set(nodes.filter((n) => n.dir).map((n) => n.path)));
  const [focused, setFocused] = useState<string | null>(null);
  const box = useRef<HTMLDivElement>(null);
  // 当前文件、正在改名的项所在的文件夹自动展开
  useEffect(() => {
    const need = [current, renaming].filter(Boolean) as string[];
    setOpen((o) => {
      const n = new Set(o);
      const walk = (ns: TreeNode[]) => ns.forEach((x) => { if (x.dir) { if (need.some((p) => p.startsWith(x.path + "/"))) n.add(x.path); walk(x.children); } });
      walk(nodes);
      return n.size === o.size ? o : n;
    });
  }, [current, renaming, nodes]);
  const rows = useMemo(() => {
    const out: Row[] = [];
    const walk = (ns: TreeNode[], depth: number, parent: string | null) => ns.forEach((n) => { out.push({ node: n, depth, parent }); if (n.dir && open.has(n.path)) walk(n.children, depth + 1, n.path); });
    walk(shown, 0, null);
    return out;
  }, [shown, open]);
  const toggle = (p: string, v?: boolean) => setOpen((o) => { const n = new Set(o); if (v ?? !n.has(p)) n.add(p); else n.delete(p); return n; });
  const activate = (n: TreeNode) => { if (n.dir) toggle(n.path); else if (isMarkdown(n.name)) onOpen(n.path); else onPreview(n.path); };

  const dnd = useTreeDrag<TreeNode>({
    targetAt: (el, item, pt) => {
      const row = el?.closest<HTMLElement>("[data-path]");
      const inTree = el?.closest(".tree, .folder");
      if (!inTree) return null;
      // 手动排序：一行的上半 / 下半是放在它前面 / 后面；文件夹的中间一段仍是「放进去」
      if (manual && row && row.dataset.path !== item.path) {
        const r = row.getBoundingClientRect(), f = (pt.y - r.top) / r.height;
        const p = row.dataset.path!;
        if (!(row.dataset.dir === "1" && f > 0.3 && f < 0.7) && !p.startsWith(item.path + "/")) return (f < 0.5 ? "before:" : "after:") + p;
      }
      // 放在文件上 = 放进它所在的文件夹；放在空白处 = 最外层
      const dir = row ? (row.dataset.dir === "1" ? row.dataset.path! : row.dataset.parent || root) : root;
      if (dir === item.path || dir.startsWith(item.path + "/")) return null; // 不能放进自己
      const from = item.path.slice(0, item.path.lastIndexOf("/"));
      return dir === from ? null : dir;
    },
    onDrop: (item, t) => {
      const m = t.match(/^(before|after):(.*)$/);
      if (!m) { onMove(item, t); return; }
      // 放在某一行前面 / 后面：换算成「放进它所在的文件夹、排在谁前面」
      const at = rows.findIndex((r) => r.node.path === m[2]);
      const row = rows[at];
      if (!row || !onReorder) return;
      const dir = row.parent || root;
      if (m[1] === "before") { onReorder(item, dir, row.node.name); return; }
      const sibs = rows.filter((r) => (r.parent || root) === dir && r.depth === row.depth);
      const next = sibs[sibs.findIndex((r) => r.node.path === row.node.path) + 1];
      onReorder(item, dir, next ? next.node.name : null);
    },
    onHoverLong: (dir) => toggle(dir, true),
  });

  const onKey = (e: React.KeyboardEvent) => {
    if (renaming || (e.target as HTMLElement).tagName === "INPUT") return;
    const i = rows.findIndex((r) => r.node.path === focused);
    const cur = rows[i];
    const go = (k: number) => { const r = rows[Math.max(0, Math.min(rows.length - 1, k))]; if (r) setFocused(r.node.path); };
    if (e.key === "ArrowDown") { e.preventDefault(); go(i < 0 ? 0 : i + 1); }
    else if (e.key === "ArrowUp") { e.preventDefault(); go(i < 0 ? 0 : i - 1); }
    else if (!cur) return;
    else if (e.key === "ArrowRight") { e.preventDefault(); if (cur.node.dir) { if (!open.has(cur.node.path)) toggle(cur.node.path, true); else go(i + 1); } }
    else if (e.key === "ArrowLeft") { e.preventDefault(); if (cur.node.dir && open.has(cur.node.path)) toggle(cur.node.path, false); else if (cur.parent) setFocused(cur.parent); }
    else if (e.key === "Enter") { e.preventDefault(); activate(cur.node); }
    else if (e.key === "F2") { e.preventDefault(); onStartRename(cur.node.path); }
    else if (e.key === "Delete" || (e.key === "Backspace" && (e.metaKey || e.ctrlKey))) { e.preventDefault(); onDelete(cur.node); go(i + 1 < rows.length ? i + 1 : i - 1); }
  };
  useLayoutEffect(() => { if (focused) box.current?.querySelector<HTMLElement>(`[data-path="${CSS.escape(focused)}"]`)?.focus(); }, [focused]);

  return (
    <div ref={box} className={"tree" + (dnd.over === root ? " drop-root" : "")} role="tree" aria-label="文件" onKeyDown={onKey}
      onContextMenu={(e) => { if (e.target === e.currentTarget) { e.preventDefault(); onMenu(e, null); } }}>
      {rows.map(({ node, depth, parent }) => {
        const style = { "--d": depth } as React.CSSProperties;
        const common = {
          "data-path": node.path, "data-dir": node.dir ? "1" : "0", "data-parent": parent ?? "",
          tabIndex: focused === node.path || (!focused && node.path === (current || rows[0]?.node.path)) ? 0 : -1,
          onFocus: () => setFocused(node.path),
          onContextMenu: (e: React.MouseEvent) => { e.preventDefault(); e.stopPropagation(); onMenu(e, node); },
          onMouseDown: (e: React.MouseEvent) => dnd.start(e, node, node.dir ? node.name : stripMd(node.name)),
          role: "treeitem",
          "aria-level": depth + 1,
        };
        const dragCls = (dnd.dragging?.path === node.path ? " dragging" : "") + (node.dir && dnd.over === node.path ? " drop" : "")
          + (dnd.over === "before:" + node.path ? " drop-before" : dnd.over === "after:" + node.path ? " drop-after" : "");
        if (renaming === node.path) return <RenameRow key={node.path} node={node} style={style} onDone={(name) => onRename(node.path, name)} />;
        if (node.dir) {
          const isOpen = open.has(node.path);
          return (
            <div key={node.path} className="tn-wrap">
              <button className={"tn dir" + (isOpen ? "" : " closed") + dragCls} style={style} onClick={() => toggle(node.path)} aria-expanded={isOpen} {...common}>
                <span className="slot"><Icon name="chev" size={12} /></span><span className="nm"><MidName name={node.name} tail={6} /></span>
              </button>
              {isOpen && !node.children.length && <div className="tn empty-dir" style={{ "--d": depth + 1 } as React.CSSProperties}>空文件夹</div>}
            </div>
          );
        }
        const md = isMarkdown(node.name);
        return (
          <button key={node.path} className={"tn" + (node.path === current ? " active" : "") + (md ? "" : " other") + dragCls} style={style}
            onClick={(e) => (e.altKey && onReference ? onReference : md ? onOpen : onPreview)(node.path)} onDoubleClick={() => !md && onOpenOther(node.path)}
            title={md ? undefined : "单击预览，双击用默认程序打开"} data-tipsrc={md ? "words" : undefined} aria-current={node.path === current ? "page" : undefined} {...common}>
            <span className="slot">{md ? <Icon name="doc" size={14} /> : <FileBadge name={node.name} />}</span>
            <span className="nm"><MidName name={md ? stripMd(node.name) : node.name} tail={md ? 6 : 8} /></span>
          </button>
        );
      })}
      <div className="tree-blank" onContextMenu={(e) => { e.preventDefault(); onMenu(e, null); }} />
    </div>
  );
}

/** 改名的输入框：选中不含扩展名的部分；回车确定，Esc 取消，点别处也算确定 */
function RenameRow({ node, style, onDone }: { node: TreeNode; style: React.CSSProperties; onDone: (name: string | null) => void }) {
  const ref = useRef<HTMLInputElement>(null);
  const done = useRef(false);
  useLayoutEffect(() => {
    const el = ref.current; if (!el) return;
    el.focus();
    const dot = node.dir ? -1 : node.name.lastIndexOf(".");
    el.setSelectionRange(0, dot > 0 ? dot : node.name.length);
  }, [node]);
  const finish = (name: string | null) => { if (done.current) return; done.current = true; onDone(name); };
  return (
    <div className="tn renaming" style={style}>
      <span className="slot"><Icon name={node.dir ? "folder" : "doc"} size={14} /></span>
      <input ref={ref} defaultValue={node.name} aria-label="新名字" spellCheck={false}
        onKeyDown={(e) => {
          if (e.nativeEvent.isComposing) return;
          if (e.key === "Enter") { e.preventDefault(); finish(e.currentTarget.value); }
          if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); finish(null); }
        }}
        onBlur={(e) => finish(e.currentTarget.value)} />
    </div>
  );
}
