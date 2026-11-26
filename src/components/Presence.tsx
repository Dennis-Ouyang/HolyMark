/**
 * 退场：包在「条件为真才渲染」的东西外面，条件变假后先留一会儿播退场动画，再真正卸下。
 *
 *   <Presence>{open && <Dialog … />}</Presence>
 *
 * 退场期间外层带 .leaving 类、不可交互（inert），动画写在 CSS 里（.leaving .scrim 等）。
 * 里面的组件在退场期间仍是同一个实例，状态不丢；条件中途又变真，就直接留下，不重新挂载。
 */
import { useEffect, useRef, useState, type ReactNode } from "react";

export function Presence({ children, ms = 140 }: { children: ReactNode; ms?: number }) {
  const shown = children !== null && children !== undefined && children !== false && children !== "";
  const last = useRef<ReactNode>(null);
  const [, rerender] = useState(0);
  if (shown) last.current = children;

  useEffect(() => {
    if (shown || last.current === null) return;
    const t = window.setTimeout(() => { last.current = null; rerender((n) => n + 1); }, ms);
    return () => window.clearTimeout(t);
  }, [shown, ms]);

  const node = shown ? children : last.current;
  if (node === null) return null;
  // 结构始终一样（同一个 div 包着同一个子树），这样进出场之间 React 不会重建里面的组件
  const leave = shown ? {} : { inert: "", "aria-hidden": true };
  return <div className={"presence" + (shown ? "" : " leaving")} {...leave}>{node}</div>;
}
