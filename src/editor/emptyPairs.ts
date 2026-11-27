/**
 * 没选文字时按 ⌘B / ⌘I / ⌘⇧X 等，会插入一对空符号（**|**），光标停在中间等着打字。
 * 如果没打字就把光标移走，这对空符号会留在正文里、显示成「****」。
 * 这里记住刚插入的空符号对：光标离开时如果里面还是空的（或者只剩别的空符号对，比如先 ⌘B 再 ⌘I），
 * 就顺手删掉。删除和移动光标在同一个事务里，撤销时一起回来。
 */
import { EditorState, StateEffect, StateField, Text, type ChangeDesc, type Extension } from "@codemirror/state";

/** a：开头符号之后；z：结尾符号之前 */
interface Pair { a: number; z: number; mark: string }
const mapPair = (p: Pair, ch: ChangeDesc): Pair => ({ a: ch.mapPos(p.a, -1), z: ch.mapPos(p.z, 1), mark: p.mark });
/** 在 from 处插入了 mark+mark，光标在中间 */
export const trackPair = StateEffect.define<{ from: number; mark: string }>({ map: (p, ch) => ({ from: ch.mapPos(p.from, 1), mark: p.mark }) });
const clear = StateEffect.define<null>();

/** 两端符号还在，中间只有格式符号（别的空符号对） */
const intact = (doc: Text, p: Pair) => {
  const n = p.mark.length;
  return p.a <= p.z && doc.sliceString(p.a - n, p.a) === p.mark && doc.sliceString(p.z, p.z + n) === p.mark && /^[*~=`$^]*$/.test(doc.sliceString(p.a, p.z));
};

const pairs = StateField.define<Pair[]>({
  create: () => [],
  update(list, tr) {
    let out = tr.docChanged ? list.map((p) => mapPair(p, tr.changes)) : list;
    for (const e of tr.effects) {
      if (e.is(clear)) out = [];
      if (e.is(trackPair)) {
        const from = e.value.from, n = e.value.mark.length;
        out = [...out, { a: from + n, z: from + n, mark: e.value.mark }];
      }
    }
    return out.filter((p) => intact(tr.state.doc, p));
  },
});

const cleanup = EditorState.transactionFilter.of((tr) => {
  const list = tr.startState.field(pairs, false);
  if (!list?.length || (!tr.selection && !tr.docChanged) || tr.effects.some((e) => e.is(trackPair))) return tr;
  const doc = tr.newDoc;
  const head = (tr.selection ?? tr.startState.selection.map(tr.changes)).main.head;
  const live = list.map((p) => mapPair(p, tr.changes)).filter((p) => intact(doc, p));
  // 光标还在某一对里面：它和它外面的几对都留着
  const gone = live.filter((p) => head < p.a || head > p.z);
  if (!gone.length) return tr;
  const del: { from: number; to: number }[] = [];
  for (const p of gone) {
    // 外层那一对已经包含了里面的，只删最外层的整段
    if (gone.some((q) => q !== p && q.a <= p.a && q.z >= p.z)) continue;
    del.push({ from: p.a - p.mark.length, to: p.z + p.mark.length });
  }
  return [tr, { changes: del, effects: clear.of(null), sequential: true }];
});

export function emptyPairs(): Extension { return [pairs, cleanup]; }
