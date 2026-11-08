// How narrow a table's column can be.
export const MIN_COLUMN_WIDTH = 48;

// The widths of a table's columns, in px, by heading.
export type Widths = Record<string, number>;

// The widths this browser saved for a table, `saved`, if they hold a width
// a column can have for every one of its `headings`.
export function savedWidthsOf(saved: string | null, headings: readonly string[]): Widths | undefined {
  if (saved === null) return undefined;
  let value: unknown;
  try {
    value = JSON.parse(saved);
  } catch {
    return undefined;
  }
  if (typeof value !== "object" || value === null || Array.isArray(value)) return undefined;
  const widths = value as Record<string, unknown>;
  const whole = headings.every((heading) => {
    const width = widths[heading];
    return typeof width === "number" && Number.isFinite(width) && width >= MIN_COLUMN_WIDTH;
  });
  return whole ? (widths as Widths) : undefined;
}

// How a table with resized columns, `widths`, lays them out: as wide as
// its columns, or as its container where they leave room, every column as
// wide as set but the last, which takes up the rest.
export type Layout = { tableWidth: string; columnWidths: Record<string, number | "auto"> };

// The layout of a table whose columns, `headings`, in order, are `widths`
// wide.
export function layoutOf(widths: Widths, headings: readonly string[]): Layout {
  const total = headings.reduce((sum, heading) => sum + (widths[heading] ?? 0), 0);
  return {
    tableWidth: `max(100%, ${total}px)`,
    columnWidths: Object.fromEntries(headings.map((heading, index) => [heading, index === headings.length - 1 ? "auto" : (widths[heading] ?? 0)])),
  };
}

// A row of a table, as fitting a column reads it: whether it is hidden from
// assistive technology, as a table's sizing row is, and its cells.
export type FitRow<C> = { hidden: boolean; cells: C[] };

// How wide the column at `index` of a table of `columns` columns needs to
// be for none of its cells in `rows` to be cut off, each as wide as
// `widthOf` says, leaving out a hidden row and a row with a cell across
// several columns, and never narrower than a column can be.
export function fittedWidth<C>(rows: FitRow<C>[], index: number, columns: number, widthOf: (cell: C) => number): number {
  const cells = rows.flatMap(({ hidden, cells }) => (hidden || cells.length !== columns ? [] : [cells[index]!]));
  return Math.max(MIN_COLUMN_WIDTH, ...cells.map(widthOf));
}

// `base` with `heading`'s column `width` wide, in whole px and never
// narrower than a column can be.
export function resized(base: Widths, heading: string, width: number): Widths {
  return { ...base, [heading]: Math.max(MIN_COLUMN_WIDTH, Math.round(width)) };
}
