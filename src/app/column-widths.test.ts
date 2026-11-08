import { describe, expect, it } from "vitest";
import { fittedWidth, layoutOf, resized, savedWidthsOf } from "./column-widths.ts";

const HEADINGS = ["Service", "Resources", "Regions", "Versions"];

describe("a table's resized columns", () => {
  it("keeps the widths this browser saved for every one of the table's headings", () => {
    const saved = JSON.stringify({ Service: 120, Resources: 80, Regions: 200, Versions: 300 });

    expect(savedWidthsOf(saved, HEADINGS)).toEqual({ Service: 120, Resources: 80, Regions: 200, Versions: 300 });
  });

  it("lets the table lay itself out when nothing is saved, or what is saved cannot be read or misses a heading", () => {
    expect(savedWidthsOf(null, HEADINGS)).toBeUndefined();
    expect(savedWidthsOf("{not json", HEADINGS)).toBeUndefined();
    expect(savedWidthsOf("[120, 80, 200, 300]", HEADINGS)).toBeUndefined();
    expect(savedWidthsOf(JSON.stringify({ Service: 120, Resources: 80, Regions: 200 }), HEADINGS)).toBeUndefined();
  });

  it("lets the table lay itself out when a saved width is not a number of px a column can have", () => {
    const widths = { Service: 120, Resources: 80, Regions: 200 };

    expect(savedWidthsOf(JSON.stringify({ ...widths, Versions: "300" }), HEADINGS)).toBeUndefined();
    expect(savedWidthsOf(JSON.stringify({ ...widths, Versions: 47 }), HEADINGS)).toBeUndefined();
    expect(savedWidthsOf(JSON.stringify({ ...widths, Versions: null }), HEADINGS)).toBeUndefined();
  });

  it("resizes one column to a whole number of px, keeping every other column's width", () => {
    const base = { Service: 120, Resources: 80, Regions: 200, Versions: 300 };

    expect(resized(base, "Regions", 250.6)).toEqual({ Service: 120, Resources: 80, Regions: 251, Versions: 300 });
    expect(base.Regions).toBe(200);
  });

  it("never narrows a column under 48px", () => {
    const base = { Service: 120, Resources: 80, Regions: 200, Versions: 300 };

    expect(resized(base, "Resources", 10)).toEqual({ ...base, Resources: 48 });
    expect(resized(base, "Resources", -40)).toEqual({ ...base, Resources: 48 });
  });

  it("makes the table as wide as its columns, or as its container where they leave room, the last column taking up the rest", () => {
    const layout = layoutOf({ Service: 120, Resources: 80, Regions: 200, Versions: 300 }, HEADINGS);

    expect(layout).toEqual({
      tableWidth: "max(100%, 700px)",
      columnWidths: { Service: 120, Resources: 80, Regions: 200, Versions: "auto" },
    });
  });

  // A table's rows, each cell as how wide its content is: the headings, a
  // sizing row hidden from assistive technology holding wider content, a
  // group's row across every column, and two rows of Components.
  const ROWS = [
    { hidden: false, cells: [90, 110, 70, 80] },
    { hidden: true, cells: [500, 500, 500, 500] },
    { hidden: false, cells: [900] },
    { hidden: false, cells: [150, 30, 260, 40] },
    { hidden: false, cells: [130, 20, 310, 30] },
  ];

  it("fits a column to the widest of its heading and the cells of the rows shown, leaving out a hidden row and a row across every column", () => {
    const widthOf = (cell: number) => cell;

    expect(fittedWidth(ROWS, 0, HEADINGS.length, widthOf)).toBe(150);
    expect(fittedWidth(ROWS, 1, HEADINGS.length, widthOf)).toBe(110);
    expect(fittedWidth(ROWS, 2, HEADINGS.length, widthOf)).toBe(310);
  });

  it("fits a column no narrower than 48px", () => {
    const rows = [
      { hidden: false, cells: [20, 20] },
      { hidden: false, cells: [30, 10] },
    ];

    expect(fittedWidth(rows, 1, 2, (cell: number) => cell)).toBe(48);
  });
});
