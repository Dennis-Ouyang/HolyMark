/** 跳转历史：点目录、搜索结果、文内链接、文件卡片时记一条（文件 + 位置），可以返回、前进。 */
export interface Loc { path: string; pos: number }
export interface Nav { back: Loc[]; fwd: Loc[] }

export const emptyNav = (): Nav => ({ back: [], fwd: [] });
const MAX = 100;
const same = (a: Loc | undefined, b: Loc) => !!a && a.path === b.path && a.pos === b.pos;

/** 要跳到别处：把现在的位置记下来，前进的那一串作废 */
export function leave(nav: Nav, cur: Loc): Nav {
  if (!cur.path) return nav;
  return { back: same(nav.back[nav.back.length - 1], cur) ? nav.back : [...nav.back, cur].slice(-MAX), fwd: [] };
}
export function goBack(nav: Nav, cur: Loc): { nav: Nav; to: Loc } | null {
  if (!nav.back.length) return null;
  const to = nav.back[nav.back.length - 1];
  return { to, nav: { back: nav.back.slice(0, -1), fwd: [...nav.fwd, cur] } };
}
export function goForward(nav: Nav, cur: Loc): { nav: Nav; to: Loc } | null {
  if (!nav.fwd.length) return null;
  const to = nav.fwd[nav.fwd.length - 1];
  return { to, nav: { back: [...nav.back, cur], fwd: nav.fwd.slice(0, -1) } };
}
/** 改名、移动、删除后：路径跟着换，删掉的去掉 */
export function renameNav(nav: Nav, from: string, to: string | null): Nav {
  const f = (l: Loc[]) => l.flatMap((x) => (x.path === from || x.path.startsWith(from + "/") ? (to === null ? [] : [{ ...x, path: to + x.path.slice(from.length) }]) : [x]));
  return { back: f(nav.back), fwd: f(nav.fwd) };
}
