import { describe, expect, it } from "vitest";
import { deleteItem, indentItem, moveItem, moveItemTo, parseList, renumber, setKind, taskInfo, toggleTask } from "../src/lib/listModel";

const L = (s: string) => s.split("\n");
const J = (a: string[] | null) => a?.join("\n");

describe("解析", () => {
  it("层级、父子、范围", () => {
    const m = parseList(L("- 一\n  - 一之一\n    续行\n  - 一之二\n- 二"));
    expect(m.items.map((x) => x.depth)).toEqual([0, 1, 1, 0]);
    expect(m.items[0].children).toEqual([1, 2]);
    expect(m.items[1].end).toBe(2);
    expect(m.items[0].end).toBe(3);
    expect(m.lines[2]).toEqual({ item: 1, cont: true, ws: 4 });
  });
  it("B7 显示编号 = 起始号 + 序号", () => {
    const m = parseList(L("8. 八\n10. 十\n11. 十一\n   1. 子\n   5. 子二"));
    expect(m.items.map((x) => x.shown)).toEqual([8, 9, 10, 1, 2]);
  });
});

describe("待办（C6）", () => {
  it("进度只数叶子：中间的父项「大人物」不算", () => {
    const m = parseList(L("- [ ] 你哈\n  - [x] 一\n  - [ ] 大人物\n    - [x] 甲\n    - [ ] 乙\n  - [x] 二"));
    expect(taskInfo(m, 0)).toEqual({ state: "partial", done: 3, total: 4 });
    expect(taskInfo(m, 2)).toEqual({ state: "partial", done: 1, total: 2 });
  });
  it("父项勾了、叶子没全勾：半选", () => {
    const m = parseList(L("- [x] 父\n  - [x] 一\n  - [ ] 二"));
    expect(taskInfo(m, 0)!.state).toBe("mixed");
  });
  it("勾上最后一个叶子，父项（和祖父项）自动勾上；取消一个叶子，父项取消", () => {
    let r = toggleTask(L("- [ ] 父\n  - [x] 一\n  - [ ] 二"), 2);
    expect(J(r.lines)).toBe("- [x] 父\n  - [x] 一\n  - [x] 二");
    r = toggleTask(r.lines, 1);
    expect(J(r.lines)).toBe("- [ ] 父\n  - [ ] 一\n  - [x] 二");
  });
  it("点父项：勾上下面所有的项；全部完成时再点：全部取消", () => {
    let r = toggleTask(L("- [ ] 父\n  - [ ] 一\n    - [ ] 甲\n  - [x] 二"), 0);
    expect(J(r.lines)).toBe("- [x] 父\n  - [x] 一\n    - [x] 甲\n  - [x] 二");
    expect(r.changed).toBe(3);
    r = toggleTask(r.lines, 0);
    expect(J(r.lines)).toBe("- [ ] 父\n  - [ ] 一\n    - [ ] 甲\n  - [ ] 二");
  });
});

describe("结构操作（C2）", () => {
  it("上移、下移连同子项", () => {
    expect(J(moveItem(L("- 一\n  - 子\n- 二"), 2, -1))).toBe("- 二\n- 一\n  - 子");
    expect(J(moveItem(L("- 一\n  - 子\n- 二"), 0, 1))).toBe("- 二\n- 一\n  - 子");
    expect(moveItem(L("- 一\n- 二"), 0, -1)).toBeNull();
  });
  it("有序列表移动后编号规整", () => {
    expect(J(moveItem(L("1. 一\n2. 二\n3. 三"), 2, -1))).toBe("1. 一\n2. 三\n3. 二");
  });
  it("缩进、取消缩进，子项一起走", () => {
    expect(J(indentItem(L("- 一\n- 二\n  - 子"), 1, 1))).toBe("- 一\n  - 二\n    - 子");
    expect(J(indentItem(L("- 一\n  - 二\n    - 子"), 1, -1))).toBe("- 一\n- 二\n  - 子");
    expect(indentItem(L("- 一"), 0, 1)).toBeNull();
    expect(J(indentItem(L("1. 一\n2. 二"), 1, 1))).toBe("1. 一\n   1. 二");
  });
  it("改类型：同一级一起改，子项跟着符号宽度挪", () => {
    expect(J(setKind(L("- 一\n  - 子\n- 二"), 0, "ordered"))).toBe("1. 一\n   - 子\n2. 二");
    expect(J(setKind(L("1. 一\n2. 二"), 1, "task"))).toBe("- [ ] 一\n- [ ] 二");
    expect(J(setKind(L("- [x] 一\n- [ ] 二"), 0, "bullet"))).toBe("- 一\n- 二");
  });
  it("删除这一项（连同子项）", () => {
    expect(J(deleteItem(L("1. 一\n   - 子\n2. 二\n3. 三"), 0))).toBe("1. 二\n2. 三");
  });
  it("拖动：换位置、改层级", () => {
    const src = L("- 一\n- 二\n- 三");
    expect(J(moveItemTo(src, 2, 0, 0))).toBe("- 三\n- 一\n- 二");
    expect(J(moveItemTo(src, 0, 3, 0))).toBe("- 二\n- 三\n- 一");
    expect(J(moveItemTo(src, 2, 2, 1))).toBe("- 一\n- 二\n  - 三");
    expect(J(moveItemTo(src, 1, 1, 5))).toBe("- 一\n  - 二\n- 三"); // 层级最多比前一项深一层
  });
  it("renumber 只改不对的编号", () => {
    expect(J(renumber(L("3. a\n3. b\n9. c")))).toBe("3. a\n4. b\n5. c");
  });
});
