/** 文件类型的图标容器（和文件卡片、文件树同一套，见 lib/fileKind.ts） */
import { fileBadgeHTML } from "../lib/fileKind";

export function FileBadge({ name, size = "sm" }: { name: string; size?: "sm" | "lg" }) {
  return <span className="fbwrap" dangerouslySetInnerHTML={{ __html: fileBadgeHTML(name, size) }} />;
}
