import { describe, expect, it } from "vitest";
import { commandForKey, keyCaps, matchKeys, menuSpec, COMMANDS } from "../src/lib/commandRegistry";

const ev = (code: string, o: Partial<KeyboardEvent> = {}) => ({ code, metaKey: false, ctrlKey: false, shiftKey: false, altKey: false, ...o }) as KeyboardEvent;

describe("命令注册表：第一批新增的命令", () => {
  it("都在注册表里，名字不重复", () => {
    for (const id of ["reading", "nav_back", "nav_forward", "fold_all", "unfold_all", "fold_h2", "folder_replace", "tidy", "math_symbols", "copy_rich", "copy_wechat", "typewriter", "para_focus", "paper_default", "paper_cream", "paper_gray", "close_preview"])
      expect(COMMANDS.some((c) => c.id === id)).toBe(true);
    expect(new Set(COMMANDS.map((c) => c.id)).size).toBe(COMMANDS.length);
  });
  it("快捷键分发：阅读模式、在文件夹里替换", () => {
    expect(commandForKey(ev("KeyR", { metaKey: true, shiftKey: true }), true)).toBe("reading");
    expect(commandForKey(ev("KeyF", { ctrlKey: true, altKey: true }), false)).toBe("folder_replace");
  });
  it("返回 / 前进由功能自己处理：不经统一分发，不挂原生菜单加速键，但键帽照常显示", () => {
    expect(commandForKey(ev("ArrowLeft", { altKey: true }), false)).toBeNull();
    const view = menuSpec().find((s) => s.key === "view")!;
    expect(view.items.find((i) => i.id === "nav_back")!.accel).toBeNull();
    expect(view.items.some((i) => i.id === "close_preview")).toBe(false);
    expect(keyCaps("Ctrl+Mod+Left", true)).toEqual(["⌃", "⌘", "←"]);
    expect(keyCaps("Alt+Left", false)).toEqual(["Alt", "←"]);
  });
  it("matchKeys", () => {
    expect(matchKeys(ev("ArrowLeft", { metaKey: true, ctrlKey: true }), "Ctrl+Mod+Left", true)).toBe(true);
    expect(matchKeys(ev("ArrowLeft", { metaKey: true }), "Ctrl+Mod+Left", true)).toBe(false);
    expect(matchKeys(ev("ArrowLeft", { altKey: true }), "Alt+Left", false)).toBe(true);
    expect(matchKeys(ev("ArrowLeft", { altKey: true, ctrlKey: true }), "Alt+Left", false)).toBe(false);
  });
});
