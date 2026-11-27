/** 中间截断的名字：长名字省略中间，保住结尾和扩展名（F4）。样式在 .mid */
import { splitMid } from "../lib/fileKind";

export function MidName({ name, tail = 8, className = "" }: { name: string; tail?: number; className?: string }) {
  const [a, b] = splitMid(name, tail);
  return <span className={"mid " + className} title={name}><span className="a">{a}</span><span className="b">{b}</span></span>;
}
