/**
 * N18 文件树手动排序的接线：按工作区读写 .holymark/order.json，给出排好的树、切换排序方式、拖动调整顺序，
 * 改名、移动、删除时同步顺序表。只有用户切到「手动拖动」或拖动过以后才写文件（只看不改不会建 .holymark/）。
 * 纯函数在 lib/manualOrder.ts。
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Backend, TreeNode } from "../lib/backend";
import { namesIn, NO_ORDER, orderText, orderTree, parseOrder, removeEntry, renameEntry, reorder, TreeOrder } from "../lib/manualOrder";
import { join } from "../lib/paths";

const relOf = (root: string, p: string) => (p === root ? "" : p.slice(root.length + 1));

export function useTreeOrder(be: Backend | null, root: string, tree: TreeNode[]) {
  const [order, setOrderState] = useState<TreeOrder>(NO_ORDER);
  const cur = useRef(order);
  cur.current = order;
  const file = root ? join(root, ".holymark/order.json") : "";
  useEffect(() => {
    setOrderState(NO_ORDER);
    if (!be || !file) return;
    let dead = false;
    be.readText(file).then((t) => { if (!dead) setOrderState(parseOrder(t)); }).catch(() => {});
    return () => { dead = true; };
  }, [be, file]);

  /** 改顺序表：有变化才写盘 */
  const setOrder = useCallback((o: TreeOrder) => {
    if (JSON.stringify(o) === JSON.stringify(cur.current)) return;
    setOrderState(o);
    cur.current = o;
    if (be && file) be.writeText(file, orderText(o)).catch(() => {});
  }, [be, file]);

  const shown = useMemo(() => orderTree(tree, order, root), [tree, order, root]);

  return {
    order,
    /** 按顺序表排好的树（文件树、批量导出都用它） */
    shown,
    manual: order.mode === "manual",
    setMode: (mode: TreeOrder["mode"]) => setOrder({ ...cur.current, mode }),
    /** 把 name 放到 dir 里 before 前面（null 是最后） */
    reorder: (dir: string, name: string, before: string | null) => setOrder(reorder(cur.current, relOf(root, dir), namesIn(shown, root, dir), name, before)),
    renamed: (from: string, to: string) => { if (root) setOrder(renameEntry(cur.current, relOf(root, from), relOf(root, to))); },
    removed: (p: string) => { if (root) setOrder(removeEntry(cur.current, relOf(root, p))); },
    /** 撤销用：整张表换回去 */
    restore: (o: TreeOrder) => setOrder(o),
  };
}
