import { describe, expect, it } from "vitest";
import { appendEntry, bibField, makeKey, parseDoi, setBibKey } from "../src/lib/doi";

const sample = ` @article{Sweller_1988, title={Cognitive Load During Problem Solving: Effects on Learning}, volume={12}, DOI={10.1207/s15516709cog1202_4}, journal={Cognitive Science}, author={Sweller, John}, year={1988}, month=apr, pages={257–285} }`;

describe("DOI", () => {
  it("认出各种写法", () => {
    expect(parseDoi("10.1207/s15516709cog1202_4")).toBe("10.1207/s15516709cog1202_4");
    expect(parseDoi("https://doi.org/10.1207/s15516709cog1202_4")).toBe("10.1207/s15516709cog1202_4");
    expect(parseDoi("http://dx.doi.org/10.1000/xyz123.")).toBe("10.1000/xyz123");
    expect(parseDoi("doi: 10.1000/ABC")).toBe("10.1000/ABC");
    expect(parseDoi("`10.1038/nature12373`")).toBe("10.1038/nature12373");
    expect(parseDoi("10.1038/nature12373。")).toBe("10.1038/nature12373");
    expect(parseDoi("zhang2021")).toBeNull();
    expect(parseDoi("10.12/x")).toBeNull();
  });
  it("读字段", () => {
    expect(bibField(sample, "author")).toBe("Sweller, John");
    expect(bibField(sample, "year")).toBe("1988");
    expect(bibField(sample, "title")).toBe("Cognitive Load During Problem Solving: Effects on Learning");
  });
  it("引用键：作者加年份，不和已有的重复", () => {
    expect(makeKey(sample, [])).toBe("sweller1988");
    expect(makeKey(sample, ["sweller1988"])).toBe("sweller1988a");
    expect(makeKey(sample, ["sweller1988", "Sweller1988a"])).toBe("sweller1988b");
    expect(makeKey("@book{x, author={Gödel, Kurt and Escher, M.}, year=1931}", [])).toBe("godel1931");
    expect(makeKey("@book{x, author={Jane Q. Doe}, year={2020}}", [])).toBe("doe2020");
    expect(makeKey("@book{x, author={张伟}, year={2021}}", [])).toBe("ref2021");
  });
  it("改写键、追加到文件", () => {
    expect(setBibKey(sample, "sweller1988a")).toMatch(/^@article\{sweller1988a, title=/);
    expect(appendEntry("@a{x,\n}\n\n\n", "@b{y,\n}")).toBe("@a{x,\n}\n\n@b{y,\n}\n");
    expect(appendEntry("", "@b{y,\n}")).toBe("@b{y,\n}\n");
  });
});
