import { describe, expect, it } from "vitest";
import { fmtDate, fmtSize, middleTruncate } from "../src/lib/fileInfo";

describe("文件名、大小、时间", () => {
  it("中间截断，保住扩展名和结尾", () => {
    expect(middleTruncate("短名字.pdf")).toBe("短名字.pdf");
    const t = middleTruncate("毕业论文第三章研究设计修改意见汇总最终版本-v3.docx", 20);
    expect(t.endsWith("-v3.docx")).toBe(true);
    expect(t.includes("…")).toBe(true);
    expect([...t].length).toBeLessThanOrEqual(20);
  });
  it("大小", () => {
    expect(fmtSize(512)).toBe("512 字节");
    expect(fmtSize(2048)).toBe("2.0 KB");
    expect(fmtSize(5 * 1024 * 1024)).toBe("5.0 MB");
  });
  it("时间", () => {
    const now = new Date(2026, 10, 27, 15, 0);
    expect(fmtDate(new Date(2026, 10, 27, 9, 5).getTime(), now)).toBe("今天 09:05");
    expect(fmtDate(new Date(2026, 10, 3, 9, 5).getTime(), now)).toBe("11月3日 09:05");
    expect(fmtDate(new Date(2025, 0, 3, 9, 5).getTime(), now)).toBe("2025年1月3日 09:05");
  });
});
