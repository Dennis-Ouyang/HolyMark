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

import { commandWithKeys, customShortcuts, isReservedKeys, keysFromEvent, loadShortcuts, resetShortcuts, setKeyRecording, setShortcut, shortcutOf } from "../src/lib/commandRegistry";

describe("自定义快捷键（N15）", () => {
  it("按下的组合键 → 注册表写法", () => {
    expect(keysFromEvent(ev("KeyE", { metaKey: true, shiftKey: true }), true)).toBe("Mod+Shift+E");
    expect(keysFromEvent(ev("Comma", { ctrlKey: true, altKey: true }), false)).toBe("Mod+Alt+,");
    expect(keysFromEvent(ev("ArrowLeft", { metaKey: true, ctrlKey: true }), true)).toBe("Ctrl+Mod+Left");
    expect(keysFromEvent(ev("KeyE"), true)).toBeNull(); // 没有修饰键
    expect(keysFromEvent(ev("F5"), true)).toBe("F5");
    expect(keysFromEvent(ev("KeyE", { metaKey: true }), false)).toBeNull(); // Windows 上按着 Win 键
  });
  it("冲突和保留的组合", () => {
    expect(commandWithKeys("Mod+Shift+E")?.id).toBe("export");
    expect(commandWithKeys("Mod+Shift+E", "export")).toBeUndefined();
    expect(isReservedKeys("Mod+C")).toBe(true);
    expect(isReservedKeys("Mod+Shift+C")).toBe(false);
  });
  it("改、存、恢复；改了以后按键分发跟着变", () => {
    setShortcut("export", "Mod+Alt+E");
    setShortcut("reading", null);
    expect(customShortcuts()).toEqual({ export: "Mod+Alt+E", reading: null });
    expect(commandForKey(ev("KeyE", { metaKey: true, altKey: true }), true)).toBe("export");
    expect(commandForKey(ev("KeyR", { metaKey: true, shiftKey: true }), true)).toBeNull();
    resetShortcuts();
    expect(shortcutOf("export")).toBe("Mod+Shift+E");
    loadShortcuts({ export: "Mod+Alt+E", nope: "Mod+J", reading: "Mod+Shift+R" }); // 不认识的、和默认一样的不记
    expect(customShortcuts()).toEqual({ export: "Mod+Alt+E" });
    resetShortcuts();
  });
  it("录按键时原生菜单不挂加速键", () => {
    setKeyRecording(true);
    expect(menuSpec().find((s) => s.key === "file")!.items.find((i) => i.id === "export")!.accel).toBeNull();
    setKeyRecording(false);
    expect(menuSpec().find((s) => s.key === "file")!.items.find((i) => i.id === "export")!.accel).toBe("CmdOrCtrl+Shift+E");
  });
});
