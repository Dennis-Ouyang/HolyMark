/**
 * 版本列表里每个版本改了多少：和它前一个（更早的）版本比，改了几段。用来给没起名字的版本当标题（「改了 3 段」）。
 * 按需读取版本内容，结果按版本 id 缓存。
 */
import { useEffect, useState } from "react";
import type { VersionMeta } from "../lib/backend";
import { alignBlocks } from "../lib/markdown";

const cache = new Map<string, number>();
/** 一个版本的改动段数；-1 表示最早的那个（没有更早的可比） */
export function useVersionStats(path: string, versions: VersionMeta[], read: (path: string, id: string) => Promise<string>) {
  const [, bump] = useState(0);
  const key = versions.map((v) => v.id).join(",");
  useEffect(() => {
    let alive = true;
    (async () => {
      const texts = new Map<string, string>();
      const get = async (id: string) => { if (!texts.has(id)) texts.set(id, await read(path, id).catch(() => "")); return texts.get(id)!; };
      for (let i = 0; i < versions.length && i < 60; i++) {
        const v = versions[i], prev = versions[i + 1];
        const k = `${v.id}|${prev?.id ?? ""}`;
        if (cache.has(k)) continue;
        if (!prev) { cache.set(k, -1); continue; }
        const rows = alignBlocks(await get(prev.id), await get(v.id));
        cache.set(k, rows.filter((r) => r.ops).length);
        if (!alive) return;
      }
      if (alive) bump((n) => n + 1);
    })();
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [path, key]);
  return (i: number): number | undefined => cache.get(`${versions[i].id}|${versions[i + 1]?.id ?? ""}`);
}

/** 没起名字的版本的标题 */
export function changeTitle(n: number | undefined): string {
  if (n === undefined) return "";
  if (n < 0) return "最早的版本";
  if (n === 0) return "没有改动";
  return `编辑过 ${n} 段`;
}
