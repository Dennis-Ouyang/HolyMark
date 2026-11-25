import { useState } from "react";
import type { TreeNode } from "../lib/backend";
import { Icon } from "./Icons";

interface Props { nodes: TreeNode[]; current: string; onOpen: (path: string) => void; showAll: boolean }

/** 默认只显示 Markdown 文件和含有 Markdown 的文件夹 */
function onlyMarkdown(nodes: TreeNode[]): TreeNode[] {
  return nodes.flatMap((n) => {
    if (!n.dir) return /\.(md|markdown)$/i.test(n.name) ? [n] : [];
    const kids = onlyMarkdown(n.children);
    return kids.length ? [{ ...n, children: kids }] : [];
  });
}

export function FileTree({ nodes, current, onOpen, showAll }: Props) {
  const shown = showAll ? nodes : onlyMarkdown(nodes);
  return <div className="tree" role="tree">{shown.map((n) => <Item key={n.path} node={n} depth={0} current={current} onOpen={onOpen} />)}</div>;
}

function Item({ node, depth, current, onOpen }: { node: TreeNode; depth: number; current: string; onOpen: (p: string) => void }) {
  const [open, setOpen] = useState(depth === 0);
  const md = /\.md$/i.test(node.name);
  if (node.dir) {
    return (
      <>
        <button className={"tn dir" + (open ? "" : " closed")} style={{ "--d": depth } as React.CSSProperties} onClick={() => setOpen(!open)} role="treeitem" aria-expanded={open}>
          <span className="chev"><Icon name="chev" size={12} /></span><span className="nm">{node.name}</span>
        </button>
        {open && <div className="kids">{node.children.map((c) => <Item key={c.path} node={c} depth={depth + 1} current={current} onOpen={onOpen} />)}</div>}
      </>
    );
  }
  const ext = node.name.includes(".") ? node.name.split(".").pop()!.toUpperCase() : "";
  return (
    <button className={"tn" + (node.path === current ? " active" : "") + (md ? "" : " other")} style={{ "--d": depth } as React.CSSProperties}
      onClick={() => md && onOpen(node.path)} title={md ? node.path : "暂时只能打开 Markdown 文件"} role="treeitem">
      <span className="ico"><Icon name={md ? "doc" : "file"} size={14} /></span>
      <span className="nm">{md ? node.name.replace(/\.md$/i, "") : node.name.replace(/\.[^.]+$/, "")}</span>
      {!md && <span className="ext">{ext}</span>}
    </button>
  );
}
