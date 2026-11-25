import { describe, expect, it } from "vitest";
import { EditorState, RangeSet, TransactionSpec } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { markdown, markdownLanguage } from "@codemirror/lang-markdown";
import { ensureSyntaxTree, syntaxTree } from "@codemirror/language";
import { build, livePreview, newMemo, PreviewOptions, setFocus, topBlocks } from "../src/editor/livePreview";
import { longManuscript } from "../src/lib/stress";

const opts = (syntax: "active" | "always"): PreviewOptions => ({ resolveImage: (s) => s, citeLabel: (k) => k, syntax: () => syntax });

function decoSet(state: EditorState) {
  const sets = state.facet(EditorView.decorations).filter((d) => typeof d !== "function");
  return sets as RangeSet<any>[];
}

describe("livePreview 增量装饰", () => {
  for (const [mode, seed0] of [["active", 11], ["always", 12], ["active", 99], ["active", 2024]] as const) {
    it(`随机编辑后与整篇重算一致（${mode}，种子 ${seed0}）`, () => {
      const o = opts(mode);
      let state = EditorState.create({ doc: longManuscript(12_000, seed0), extensions: [markdown({ base: markdownLanguage }), livePreview(o)] });
      state = state.update({ effects: setFocus.of(true) }).state;
      let seed: number = seed0;
      const r = () => ((seed = (seed * 1103515245 + 12345) >>> 0) / 0x100000000);
      const inserts = ["字", "\n", "\n\n", "\n\n\n", "**粗**", "$x$", "| a | b |\n| --- | --- |\n| 1 | 2 |", "```\ncode\n", "```", "- 列表\n", "# 标题\n", "[@k]",
        "$$\n", "$$", "---\n", "> 引用", "![图](a.png)", "{==原==}{>>批注<<}", "1. 一\n2. 二\n", "- [ ] 任务"];
      let compared = 0, maxSize = 0;
      for (let i = 0; i < 400; i++) {
        const len = state.doc.length;
        const at = Math.floor(r() * len);
        const k = r();
        let spec: TransactionSpec;
        if (k < 0.35) spec = { changes: { from: at, insert: inserts[Math.floor(r() * inserts.length)] }, selection: { anchor: at } };
        else if (k < 0.5) spec = { changes: { from: at, to: Math.min(len, at + 1 + Math.floor(r() * 30)) }, selection: { anchor: at } };
        else if (k < 0.55) spec = { changes: { from: at, to: Math.min(len, at + 200 + Math.floor(r() * 800)) } }; // 删掉一大段，跨多个块
        else if (k < 0.6) { const b2 = Math.floor(r() * len); spec = { changes: [{ from: Math.min(at, b2), insert: "甲" }, { from: Math.max(at, b2), insert: "\n\n乙" }] }; } // 一次改两处
        else if (k < 0.63) spec = { effects: setFocus.of(r() < 0.5) };
        else if (k < 0.7) { const ch = ["*", "$", "`", "x", "字", "#", "|", "~"][Math.floor(r() * 8)]; spec = { changes: { from: at, to: Math.min(len, at + 1), insert: ch } }; } // 等长替换：位置长度都不变，内容变了
        else if (k < 0.73) spec = { selection: { anchor: at, head: Math.min(len, at + Math.floor(r() * 2000)) } }; // 跨块选区
        else spec = { selection: { anchor: at } };
        state = state.update(spec).state;
        // 模拟后台解析完成：先把语法树解析到底，再用一个空事务让它生效
        if (r() < 0.6) { ensureSyntaxTree(state, state.doc.length, 5000); state = state.update({}).state; }
        if (syntaxTree(state).length < state.doc.length) continue; // 还没解析完的状态不比较
        const fresh = build(state, o, newMemo());
        const sets = decoSet(state);
        // 第一个是实时预览，第二个是改动高亮（这里是空的）
        expect(sets).toHaveLength(2);
        maxSize = Math.max(maxSize, fresh.size);
        if (!RangeSet.eq([sets[0]], [fresh])) throw new Error(`第 ${i} 步不一致`);
        compared++;
      }
      expect(compared).toBeGreaterThan(150);
      expect(maxSize).toBeGreaterThan(100);
    });
  }
});

describe("topBlocks 识别属性区与公式块", () => {
  const kinds = (doc: string) => {
    const state = EditorState.create({ doc, extensions: [markdown({ base: markdownLanguage })] });
    ensureSyntaxTree(state, doc.length, 5000);
    return topBlocks(state.update({}).state).filter((b) => b.kind === "math" || b.kind === "frontmatter").map((b) => [b.kind, doc.slice(b.from, b.to)]);
  };
  it("属性区、多行与单行公式、代码块里的 $$ 不算", () => {
    expect(kinds("---\ntitle: x\n---\n\n$$\na\n$$\n\n$$ b $$\n\n```\n$$\nc\n$$\n```\n")).toEqual([
      ["frontmatter", "---\ntitle: x\n---"], ["math", "$$\na\n$$"], ["math", "$$ b $$"],
    ]);
  });
  it("没有闭合的属性区当作正文；没有闭合的 $$ 之后仍能识别单行公式", () => {
    expect(kinds("---\n$$ a $$\n")).toEqual([["math", "$$ a $$"]]);
    expect(kinds("段落\n\n$$\n没闭合\n\n$$ b $$\n")).toEqual([["math", "$$ b $$"]]);
  });
});

describe("段间空行", () => {
  const gapLines = (state: EditorState) => {
    const out: number[] = [];
    decoSet(state)[0].between(0, state.doc.length, (from, _to, v) => { if ((v.spec as { class?: string }).class === "hm-gap") out.push(state.doc.lineAt(from).number); });
    return out;
  };
  it("光标停在空行上时按正常行高显示，离开后再收窄", () => {
    const doc = "第一段\n\n第二段\n\n第三段";
    let state = EditorState.create({ doc, extensions: [markdown({ base: markdownLanguage }), livePreview(opts("active"))] });
    state = state.update({ effects: setFocus.of(true) }).state;
    expect(gapLines(state)).toEqual([2, 4]);
    state = state.update({ selection: { anchor: doc.indexOf("\n\n") + 1 } }).state; // 第 2 行
    expect(gapLines(state)).toEqual([4]);
    expect(RangeSet.eq([decoSet(state)[0]], [build(state, opts("active"), newMemo())])).toBe(true);
    state = state.update({ selection: { anchor: doc.length } }).state;
    expect(gapLines(state)).toEqual([2, 4]);
    // 编辑器没有焦点时不显示光标，空行保持收窄
    state = state.update({ selection: { anchor: doc.indexOf("\n\n") + 1 }, effects: setFocus.of(false) }).state;
    expect(gapLines(state)).toEqual([2, 4]);
  });
});
