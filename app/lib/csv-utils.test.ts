// app/lib/csv-utils.test.ts
import { describe, it, expect } from "vitest";
import { escapeCSVField, generateCSV } from "./csv-utils";

describe("escapeCSVField", () => {
  it("returns plain strings unchanged", () => {
    expect(escapeCSVField("hello")).toBe("hello");
  });

  it("wraps strings with commas in quotes", () => {
    expect(escapeCSVField("a,b")).toBe('"a,b"');
  });

  it("escapes double quotes", () => {
    expect(escapeCSVField('say "hi"')).toBe('"say ""hi"""');
  });

  it("wraps strings with newlines in quotes", () => {
    expect(escapeCSVField("line1\nline2")).toBe('"line1\nline2"');
  });

  it("flattens newlines to pipes when option is set", () => {
    expect(escapeCSVField("line1\nline2", { flattenNewlines: true })).toBe("line1 | line2");
  });

  it("handles empty strings", () => {
    expect(escapeCSVField("")).toBe("");
  });
});

describe("generateCSV", () => {
  it("produces header + data rows", () => {
    const csv = generateCSV(["A", "B"], [["1", "2"], ["3", "4"]]);
    expect(csv).toBe("A,B\n1,2\n3,4");
  });

  it("escapes fields in rows", () => {
    const csv = generateCSV(["Name"], [['O"Brien']]);
    expect(csv).toBe('Name\n"O""Brien"');
  });

  it("flattens newlines when option is set", () => {
    const csv = generateCSV(["Desc"], [["a\nb"]], { flattenNewlines: true });
    expect(csv).toBe("Desc\na | b");
  });
});
