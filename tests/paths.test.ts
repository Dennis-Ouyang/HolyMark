import { describe, expect, it } from "vitest";
import { baseName, dirOf, isInside, join, normalize, relative, toPosix } from "../src/lib/paths";
import { kbd, keyName } from "../src/lib/platform";

describe("paths", () => {
  it("macOS / Linux 路径", () => {
    expect(dirOf("/a/b/c.md")).toBe("/a/b");
    expect(dirOf("/c.md")).toBe("/");
    expect(baseName("/a/b/c.md")).toBe("c.md");
    expect(normalize("/a/b/../c/./d.png")).toBe("/a/c/d.png");
    expect(relative("/a/b", "/a/c/d.md")).toBe("../c/d.md");
    expect(isInside("/a/b", "/a/b/c.md")).toBe(true);
    expect(isInside("/a/b", "/a/bc/d.md")).toBe(false);
    expect(toPosix("/a\\b")).toBe("/a\\b"); // Unix 文件名里的反斜杠不动
  });
  it("Windows 路径", () => {
    expect(toPosix("C:\\Users\\我\\稿子\\第一章.md")).toBe("C:/Users/我/稿子/第一章.md");
    expect(toPosix("\\\\server\\share\\a.md")).toBe("//server/share/a.md");
    expect(dirOf("C:/Users/我/a.md")).toBe("C:/Users/我");
    expect(dirOf("D:/a.md")).toBe("D:/");
    expect(join(dirOf("D:/a.md"), "assets")).toBe("D:/assets");
    expect(normalize("C:/稿子/正文/../资料/图.png")).toBe("C:/稿子/资料/图.png");
    expect(normalize("C:/../a")).toBe("C:/a");
    expect(normalize("//server/share/x/../y")).toBe("//server/share/y");
    expect(relative("C:/稿子/正文", "C:/稿子/资料/图.png")).toBe("../资料/图.png");
    expect(relative("C:/Users/Me", "c:/users/me/a.md")).toBe("a.md");
    expect(isInside("C:/稿子", "c:/稿子/正文/a.md")).toBe(true);
    expect(isInside("C:/稿子", "C:/稿子二/a.md")).toBe(false);
  });
});

describe("快捷键显示", () => {
  it("Mac 原样，其他平台换成 Ctrl / Shift / Alt", () => {
    expect(kbd("⌘⇧X", true)).toBe("⌘⇧X");
    expect(kbd("粗体 ⌘B", false)).toBe("粗体 Ctrl+B");
    expect(kbd("⌘ ⇧ 8 / 7 / 9", false)).toBe("Ctrl+Shift+8 / 7 / 9");
    expect(kbd("⌘⌥M", false)).toBe("Ctrl+Alt+M");
    expect(kbd("Tab / ⇧ Tab", false)).toBe("Tab / Shift+Tab");
    expect(keyName("⌘", false)).toBe("Ctrl");
    expect(keyName("S", false)).toBe("S");
  });
});

describe("菜单快捷键", async () => {
  const { menuIdFor, SHORTCUTS } = await import("../src/lib/shortcuts");
  const ev = (code: string, m: Partial<KeyboardEvent> = {}) => ({ code, metaKey: false, ctrlKey: false, shiftKey: false, altKey: false, ...m });
  it("Windows 用 Ctrl，Mac 用 ⌘，按物理键位匹配", () => {
    expect(menuIdFor(ev("KeyS", { ctrlKey: true }), false)).toBe("save_version");
    expect(menuIdFor(ev("KeyS", { metaKey: true }), true)).toBe("save_version");
    expect(menuIdFor(ev("KeyS", { metaKey: true }), false)).toBe(null);
    expect(menuIdFor(ev("Digit8", { ctrlKey: true, shiftKey: true }), false)).toBe("block_ul");
    expect(menuIdFor(ev("Period", { ctrlKey: true, shiftKey: true }), false)).toBe("block_quote");
    expect(menuIdFor(ev("Backslash", { ctrlKey: true }), false)).toBe("toggle_side");
    expect(menuIdFor(ev("KeyM", { ctrlKey: true, altKey: true }), false)).toBe("note");
    expect(menuIdFor(ev("KeyM", { ctrlKey: true }), false)).toBe(null);
    expect(menuIdFor(ev("KeyS"), false)).toBe(null);
  });
  it("与 Rust 原生菜单的快捷键一致", async () => {
    const fs = await import("node:fs" as string); // 测试在 Node 里跑
    const rs = fs.readFileSync(new URL("../src-tauri/src/menu.rs", import.meta.url), "utf8");
    const native = [...rs.matchAll(/item\("(\w+)", "[^"]*", Some\("CmdOrCtrl\+([^"]+)"\)\)/g)].map((m) => [`Mod+${m[2].replace(/\\\\/g, "\\")}`, m[1]]);
    // 撤销重做交给编辑器；退出只在 Mac 菜单里（Windows 用 Alt+F4 和窗口按钮）
    const skip = new Set(["undo", "redo", "quit"]);
    expect(native.filter(([, id]) => !skip.has(id)).sort()).toEqual([...SHORTCUTS()].sort());
  });
});

describe("fontStack", async () => {
  const { fontStack } = await import("../src/lib/settings");
  it("带上另一个系统的对应字体", () => {
    expect(fontStack("Songti SC")).toBe('"Songti SC","SimSun","Noto Serif SC",serif');
    expect(fontStack("SimSun")).toBe('"SimSun","Songti SC","Noto Serif SC",serif');
    expect(fontStack("Microsoft YaHei")).toBe('"Microsoft YaHei","PingFang SC","Noto Sans SC",-apple-system,sans-serif');
    expect(fontStack("Smiley Sans")).toBe('"Smiley Sans",-apple-system,"PingFang SC","Microsoft YaHei","Noto Sans SC",sans-serif');
    expect(fontStack("")).toBe('-apple-system,"PingFang SC","Microsoft YaHei","Noto Sans SC",sans-serif');
  });
});

import { isMarkdown, stripMd } from "../src/lib/paths";
describe("Markdown 扩展名（B17）", () => {
  it("md、markdown，不分大小写", () => {
    for (const n of ["a.md", "a.MD", "a.markdown", "a.Markdown"]) expect(isMarkdown(n)).toBe(true);
    for (const n of ["a.mdx", "a.txt", "md"]) expect(isMarkdown(n)).toBe(false);
    expect(stripMd("第一章.Markdown")).toBe("第一章");
  });
});

describe("命令注册表（G6）", async () => {
  const R = await import("../src/lib/commandRegistry");
  it("每条命令有类别，id 不重复；「插入」类给斜杠菜单用", () => {
    const ids = R.COMMANDS.map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(R.commandsIn("insert").map((c) => c.id)).toContain("insert_table");
  });
  it("快捷键能在运行时修改，按键分发和菜单描述跟着变", () => {
    const ev = (code: string, m: Partial<KeyboardEvent> = {}) => ({ code, metaKey: false, ctrlKey: false, shiftKey: false, altKey: false, ...m });
    let n = 0;
    const off = R.onShortcutsChange(() => n++);
    R.setShortcut("insert_table", "Mod+Alt+T");
    expect(R.commandForKey(ev("KeyT", { ctrlKey: true, altKey: true }), false)).toBe("insert_table");
    expect(R.menuSpec().find((s) => s.key === "insert")!.items.find((i) => i.id === "insert_table")!.accel).toBe("CmdOrCtrl+Alt+T");
    R.setShortcut("bold", null);
    expect(R.commandForKey(ev("KeyB", { ctrlKey: true }), false)).toBe(null);
    R.resetShortcuts();
    expect(R.commandForKey(ev("KeyB", { ctrlKey: true }), false)).toBe("bold");
    expect(n).toBe(3);
    off();
  });
  it("键帽和提示文字按平台", () => {
    expect(R.keyCaps("Mod+Shift+E", true)).toEqual(["⌘", "⇧", "E"]);
    expect(R.keyText("Mod+Shift+E", false)).toBe("Ctrl+Shift+E");
    expect(R.keyText("Mod+\\", true)).toBe("⌘\\");
  });
});


describe("悬停提示拆出快捷键（H33）", async () => {
  const { splitTip } = await import("../src/components/Tooltip");
  it("结尾的快捷键拆成键帽", () => {
    expect(splitTip("导出 ⌘⇧E")).toEqual(["导出", "⌘⇧E"]);
    expect(splitTip("切换侧栏 Ctrl+\\")).toEqual(["切换侧栏", "Ctrl+\\"]);
    expect(splitTip("在访达中显示")).toEqual(["在访达中显示", ""]);
  });
});
