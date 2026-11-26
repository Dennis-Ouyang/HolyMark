/**
 * 编辑器扩展向应用发提示条的出口。扩展不依赖 React，应用启动时用 setNotifier 接上自己的 say()。
 * kind：success 成功、info 普通（不带点）、warn 警告、error 出错。
 */
export type NoticeKind = "success" | "info" | "warn" | "error";
export interface NoticeAction { label: string; run: () => void }
type Notifier = (msg: string, kind: NoticeKind, action?: NoticeAction) => void;

let notifier: Notifier = () => {};
export function setNotifier(f: Notifier) { notifier = f; }
export function notify(msg: string, kind: NoticeKind = "info", action?: NoticeAction) { notifier(msg, kind, action); }

/** 同一条说明只提示一次（记在本机，换设备会再提示一次） */
export function notifyOnce(id: string, msg: string, kind: NoticeKind = "info") {
  const k = "hm-once-" + id;
  try { if (localStorage.getItem(k)) return; localStorage.setItem(k, "1"); } catch { /* 存不了就每次都提示 */ }
  notify(msg, kind);
}
