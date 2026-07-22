import { describe, it, expect } from "vitest";
import { toCsv } from "./csvExport";

describe("toCsv", () => {
  it("escapes commas, quotes, and newlines", () => {
    const csv = toCsv([
      { a: 'hello, "world"', b: "line1\nline2", c: 5, d: null },
    ], ["a", "b", "c", "d"]);
    expect(csv).toBe(
      'a,b,c,d\n"hello, ""world""","line1\nline2",5,',
    );
  });

  it("preserves the unknown sentinel", () => {
    const csv = toCsv([{ model: "unknown" }], ["model"]);
    expect(csv).toBe("model\nunknown");
  });

  it("returns just the header when only columns are provided", () => {
    expect(toCsv([], ["a", "b"])).toBe("a,b");
  });
});