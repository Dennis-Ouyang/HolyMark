/** 图标组件：图形来自 Tabler Icons（见 src/lib/icons.ts），统一 1.75 线宽 */
import { iconBody } from "../lib/icons";

export function Icon({ name, size = 16 }: { name: string; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round"
      aria-hidden="true" dangerouslySetInnerHTML={{ __html: iconBody(name) }} />
  );
}
