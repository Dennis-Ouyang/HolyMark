import { describe, expect, it } from "vitest";
import { EditorState } from "@codemirror/state";
import { markdown, markdownLanguage } from "@codemirror/lang-markdown";
import { filterSlash, initials, slashItems, slashQuery } from "../src/lib/slashItems";
import { slashField } from "../src/editor/slashMenu";

describe("斜杠菜单的数据", () => {
  const items = slashItems();
  it("来自命令注册表，按三组分", () => {
    expect(items.map((x) => x.id)).toContain("insert_table");
    expect(items.find((x) => x.id === "note")!.group).toBe("审阅");
    expect(items.find((x) => x.id === "block_h1")!.group).toBe("段落与列表");
    expect(items.find((x) => x.id === "insert_image")!.title).toBe("图片"); // 去掉末尾的「…」
  });
  it("中文、英文、拼音首字母都能筛", () => {
    expect(filterSlash(items, "表")[0].id).toBe("insert_table");
    expect(filterSlash(items, "table")[0].id).toBe("insert_table");
    expect(filterSlash(items, "bg")[0].id).toBe("insert_table");
    expect(filterSlash(items, "gsk")[0].id).toBe("insert_math");
    expect(filterSlash(items, "h2")[0].id).toBe("block_h2");
    expect(filterSlash(items, "home")).toEqual([]);
    expect(initials("代码块")).toBe("dmk");
  });
  it("行首的 / 或 、才算", () => {
    expect(slashQuery("/", 1)).toEqual({ at: 0, query: "" });
    expect(slashQuery("  、bg", 5)).toEqual({ at: 2, query: "bg" });
    expect(slashQuery("文字/", 3)).toBeNull();
    expect(slashQuery("/home ", 6)).toBeNull(); // 后面跟了空格
  });
});

describe("斜杠菜单的开关", () => {
  const mk = (doc: string) => EditorState.create({ doc, selection: { anchor: doc.length }, extensions: [markdown({ base: markdownLanguage }), slashField] });
  const type = (st: EditorState, text: string) => st.update({ changes: { from: st.selection.main.head, insert: text }, selection: { anchor: st.selection.main.head + text.length }, userEvent: "input.type" }).state;
  it("行首输入 / 弹出，接着输入筛选，空格关闭", () => {
    let st = type(mk("第一段\n\n"), "/");
    expect(st.field(slashField)?.items.length).toBeGreaterThan(5);
    st = type(st, "bg");
    expect(st.field(slashField)?.items[0].id).toBe("insert_table");
    st = type(st, " ");
    expect(st.field(slashField)).toBeNull();
  });
  it("中文输入法的「、」也行；筛不出东西就关", () => {
    let st = type(mk(""), "、");
    expect(st.field(slashField)).not.toBeNull();
    st = type(st, "zzz");
    expect(st.field(slashField)).toBeNull();
  });
  it("句子中间、代码块里不弹", () => {
    expect(type(mk("文字"), "/").field(slashField)).toBeNull();
    expect(type(mk("```\n"), "/").field(slashField)).toBeNull();
  });
});
