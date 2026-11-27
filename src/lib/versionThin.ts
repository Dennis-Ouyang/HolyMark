/**
 * 版本列表的稀疏规则（G7），和 Rust 端 versions::thin 一样：
 * 自动版本和外部修改一天内全留，两周内每小时留最后一个，更早的每天留最后一个；你保存的全留。
 * 只影响列出来的版本，不删除存储。
 */
import type { VersionMeta } from "./backend";

/** versions 按时间从新到旧 */
export function thinVersions(versions: VersionMeta[], now = Date.now()): VersionMeta[] {
  const H = 3_600_000, D = 24 * H;
  const seen = new Set<string>();
  return versions.filter((v) => {
    if (v.source === "saved") return true;
    const age = now - v.at;
    if (age < D) return true;
    const b = age < 14 * D ? `h${Math.floor(v.at / H)}` : `d${Math.floor(v.at / D)}`;
    if (seen.has(b)) return false;
    seen.add(b);
    return true;
  });
}
