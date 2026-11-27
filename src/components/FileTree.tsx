import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { TreeNode } from "../lib/backend";
import { Icon } from "./Icons";

interface Props {
  nodes: TreeNode[];
  current: string;
  onOpen: (path: string) => void;
  showAll: boolean;
  /** 正在改名的路径：这一行显示输入框 */
  renaming: string | null;
  onRename: (path: string, name: string | null) => void;
  /** 右键：node 为 null 表示点在空白处 */
  onMenu: (e: React.MouseEvent, node: TreeNode | null) => void;
}

/** 默认只显示 Markdown 文件和含有 Markdown 的文件夹（空文件夹也显示，刚新建的才看得见） */
function onlyMarkdown(nodes: TreeNode[]): TreeNode[] {
  return nodes.flatMap((n) => {
    if (!n.dir) return /\.(md|markdown)$/i.test(n.name) ? [n] : [];
    const kids = onlyMarkdown(n.children);
    return kids.length || !n.children.length ? [{ ...n, children: kids }] : [];
  });
}

export function FileTree({ nodes, current, onOpen, showAll, renaming, onRename, onMenu }: Props) {
  const shown = showAll ? nodes : onlyMarkdown(nodes);
  return (
    <div className="tree" role="tree" onContextMenu={(e) => { if (e.target === e.currentTarget) { e.preventDefault(); onMenu(e, null); } }}>
      {shown.map((n) => <Item key={n.path} node={n} depth={0} {...{ current, onOpen, renaming, onRename, onMenu }} />)}
      <div className="tree-blank" onContextMenu={(e) => { e.preventDefault(); onMenu(e, null); }} />
    </div>
  );
}

type ItemProps = { node: TreeNode; depth: number } & Pick<Props, "current" | "onOpen" | "renaming" | "onRename" | "onMenu">;

function Item({ node, depth, current, onOpen, renaming, onRename, onMenu }: ItemProps) {
  const [open, setOpen] = useState(depth === 0);
  // 当前文件、正在改名的项在这个文件夹里时，自动展开
  useEffect(() => {
    if ([current, renaming].some((p) => p && p.startsWith(node.path + "/"))) setOpen(true);
  }, [current, renaming, node.path]);
  const md = /\.(md|markdown)$/i.test(node.name);
  const menu = (e: React.MouseEvent) => { e.preventDefault(); e.stopPropagation(); onMenu(e, node); };
  const style = { "--d": depth } as React.CSSProperties;
  if (renaming === node.path) {
    return <>
      <RenameRow node={node} style={style} onDone={(name) => onRename(node.path, name)} />
      {node.dir && open && <div className="kids">{node.children.map((c) => <Item key={c.path} node={c} depth={depth + 1} {...{ current, onOpen, renaming, onRename, onMenu }} />)}</div>}
    </>;
  }
  if (node.dir) {
    return (
      <>
        <button className={"tn dir" + (open ? "" : " closed")} style={style} data-path={node.path} onClick={() => setOpen(!open)} onContextMenu={menu} role="treeitem" aria-expanded={open}>
          <span className="chev"><Icon name="chev" size={12} /></span><span className="nm">{node.name}</span>
        </button>
        {open && <div className="kids">{node.children.length ? node.children.map((c) => <Item key={c.path} node={c} depth={depth + 1} {...{ current, onOpen, renaming, onRename, onMenu }} />)
          : <div className="tn empty-dir" style={{ "--d": depth + 1 } as React.CSSProperties}>空文件夹</div>}</div>}
      </>
    );
  }
  const ext = node.name.includes(".") ? node.name.split(".").pop()!.toUpperCase() : "";
  return (
    <button className={"tn" + (node.path === current ? " active" : "") + (md ? "" : " other")} style={style}
      onClick={() => onOpen(node.path)} onContextMenu={menu} data-path={node.path} role="treeitem">
      <span className="ico"><Icon name={md ? "doc" : "file"} size={14} /></span>
      <span className="nm">{md ? node.name.replace(/\.(md|markdown)$/i, "") : node.name.replace(/\.[^.]+$/, "")}</span>
      {!md && <span className="ext">{ext}</span>}
    </button>
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
      <span className="ico"><Icon name={node.dir ? "folder" : "doc"} size={14} /></span>
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
