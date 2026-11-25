/**
 * Windows 上自己画的最小化、最大化、关闭按钮（窗口没有系统标题栏）。
 * 图标用系统自带的 Segoe Fluent Icons（Windows 11）/ Segoe MDL2 Assets（Windows 10），和系统按钮一模一样。
 */
import { useEffect, useState } from "react";

type Win = Awaited<ReturnType<typeof load>>;
async function load() {
  const { getCurrentWindow } = await import("@tauri-apps/api/window");
  return getCurrentWindow();
}

/** 关闭时先保存，由 App 里的 onCloseRequested 负责 */
export function WindowControls() {
  const [win, setWin] = useState<Win | null>(null);
  const [max, setMax] = useState(false);
  useEffect(() => {
    let un: (() => void) | undefined, alive = true;
    load().then(async (w) => {
      if (!alive) return;
      setWin(w);
      setMax(await w.isMaximized());
      un = await w.onResized(async () => setMax(await w.isMaximized()));
    });
    return () => { alive = false; un?.(); };
  }, []);
  return (
    <div className="winctl">
      <button aria-label="最小化" title="最小化" onClick={() => win?.minimize()}>{""}</button>
      <button aria-label={max ? "向下还原" : "最大化"} title={max ? "向下还原" : "最大化"} onClick={() => win?.toggleMaximize()}>{max ? "" : ""}</button>
      <button className="close" aria-label="关闭" title="关闭" onClick={() => win?.close()}>{""}</button>
    </div>
  );
}
