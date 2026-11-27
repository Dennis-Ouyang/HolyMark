/**
 * N20 并排参考的状态：参考哪个文件、面板多宽；按工作区记住上次参考的文件（存在本机，不写进文件夹）。
 * 打开时右栏自动收起、关掉后恢复（由 App 传 hidePanel / restorePanel 进来）。
 */
import { useCallback, useEffect, useRef, useState } from "react";
import type { TreeNode } from "../lib/backend";
import { REF_DEFAULT_W } from "./RefPane";

const KEY = (root: string) => "holymark-ref:" + root;
const W_KEY = "holymark-ref-width";
const has = (ns: TreeNode[], p: string): boolean => ns.some((n) => n.path === p || (n.dir && has(n.children, p)));
const store = (k: string, v: string | null) => { try { if (v) localStorage.setItem(k, v); else localStorage.removeItem(k); } catch { /* 存不了就算了 */ } };

export function useRefPane(root: string, tree: TreeNode[], panel: { hide: () => boolean; restore: () => void }) {
  const [path, setPath] = useState("");
  const [width, setWidthState] = useState(() => { try { return +(localStorage.getItem(W_KEY) || 0) || REF_DEFAULT_W; } catch { return REF_DEFAULT_W; } });
  /** 窄窗口时正文和参考二选一 */
  const [focus, setFocus] = useState<"doc" | "ref">("ref");
  const hidPanel = useRef(false);
  const pending = useRef("");
  const p = useRef(panel);
  p.current = panel;

  // 换了工作区：读这个工作区上次参考的文件（等文件树出来再确认文件还在）
  useEffect(() => {
    setPath("");
    try { pending.current = root ? localStorage.getItem(KEY(root)) || "" : ""; } catch { pending.current = ""; }
  }, [root]);
  useEffect(() => {
    if (!pending.current || !tree.length) return;
    const want = pending.current;
    pending.current = "";
    if (has(tree, want)) { setPath(want); hidPanel.current = p.current.hide(); }
  }, [tree]);

  const open = useCallback((f: string) => {
    if (!path) hidPanel.current = p.current.hide();
    setPath(f);
    setFocus("ref");
    if (root) store(KEY(root), f);
  }, [path, root]);
  const close = useCallback(() => {
    setPath("");
    if (root) store(KEY(root), null);
    if (hidPanel.current) { hidPanel.current = false; p.current.restore(); }
  }, [root]);
  const setWidth = useCallback((w: number) => { setWidthState(w); store(W_KEY, String(w)); }, []);
  return { path, width, setWidth, open, close, focus, setFocus };
}
