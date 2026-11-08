"use client";

import { type CSSProperties, type PointerEvent, type ReactNode, useEffect, useRef, useState } from "react";
import { fittedWidth, layoutOf, MIN_COLUMN_WIDTH, resized, savedWidthsOf, type Widths } from "./column-widths.ts";

// Resizable columns for a table, `table`, whose columns are `headings`, in
// order. Until one is resized the table lays its columns out as it would
// anyway; from then on every column keeps a width of its own, the table is
// as wide as they are, or fills its container, the last column widening to
// do so, and a cell's content that runs past its column is cut off. This
// browser remembers the widths of `table`'s columns, so that reloads and
// live updates keep them, as long as its headings stay the same.
//
// Dragging a column's resizer, at its heading's right edge, widens or
// narrows it; double-clicking it fits the column to what its heading and
// the rows shown hold.
export function useColumnWidths(table: string, headings: readonly string[]) {
  const ref = useRef<HTMLTableElement>(null);
  const key = `awol:column-widths:${table}`;
  const [widths, setWidths] = useState<Widths>();

  // Read after the first render, which the server renders too. The
  // headings matter only by name.
  const names = headings.join("\n");
  useEffect(() => {
    try {
      const saved = savedWidthsOf(localStorage.getItem(key), names.split("\n"));
      if (saved !== undefined) setWidths(saved);
    } catch {
      // No storage: the table lays itself out.
    }
  }, [key, names]);

  useEffect(() => {
    if (widths === undefined) return;
    try {
      localStorage.setItem(key, JSON.stringify(widths));
    } catch {
      // No storage: the widths last until the page is left.
    }
  }, [key, widths]);

  // Every column's width now, as laid out: as set, but for the last column
  // where it fills the table, or, before any is set, as the table lays them
  // out on its own.
  function current(): Widths {
    const cells = ref.current?.tHead?.rows[0]?.cells;
    return Object.fromEntries(
      headings.map((heading, index) => [heading, Math.round(cells?.[index]?.getBoundingClientRect().width ?? widths?.[heading] ?? MIN_COLUMN_WIDTH)]),
    );
  }

  // Fits `heading`'s column to what its heading and the rows shown hold.
  function fit(heading: string) {
    const index = headings.indexOf(heading);
    const element = ref.current;
    if (element === null || index === -1) return;
    const rows = [...element.rows].map((row) => ({ hidden: row.getAttribute("aria-hidden") === "true", cells: [...row.cells] }));
    setWidths(resized(current(), heading, fittedWidth(rows, index, headings.length, contentWidth)));
  }

  const layout = widths === undefined ? undefined : layoutOf(widths, headings);
  return {
    // The ref of the table itself.
    ref,
    // The classes and style of the table itself, once a column is resized.
    tableClassName: layout === undefined ? undefined : "table-fixed [&_td]:overflow-hidden [&_td]:text-ellipsis [&_th]:overflow-hidden",
    tableStyle: layout === undefined ? undefined : ({ width: layout.tableWidth } satisfies CSSProperties),
    // The style of `heading`'s heading cell, which needs to be `relative`
    // for its resizer.
    head: (heading: string): CSSProperties | undefined => (layout === undefined ? undefined : { width: layout.columnWidths[heading] }),
    // The resizer of `heading`'s column, to put in its heading cell.
    resizer: (heading: string): ReactNode => (
      <ColumnResizer heading={heading} start={current} onResize={(base, width) => setWidths(resized(base, heading, width))} onFit={() => fit(heading)} />
    ),
  };
}

// The handle at a heading's right edge that resizes its column, `heading`,
// from the widths when dragging starts, `start`, and fits it on a double
// click.
function ColumnResizer({
  heading,
  start,
  onResize,
  onFit,
}: {
  heading: string;
  start: () => Widths;
  onResize: (base: Widths, width: number) => void;
  onFit: () => void;
}) {
  const drag = useRef<{ x: number; base: Widths }>(undefined);

  function down(event: PointerEvent<HTMLSpanElement>) {
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    drag.current = { x: event.clientX, base: start() };
  }

  function move(event: PointerEvent<HTMLSpanElement>) {
    if (drag.current === undefined) return;
    const { x, base } = drag.current;
    onResize(base, (base[heading] ?? MIN_COLUMN_WIDTH) + event.clientX - x);
  }

  function up() {
    drag.current = undefined;
  }

  return (
    <span
      role="separator"
      aria-orientation="vertical"
      aria-label={`Resize ${heading}`}
      title="Drag to resize, double-click to fit"
      className="absolute top-0 right-0 h-full w-2 cursor-col-resize touch-none select-none after:absolute after:inset-y-2 after:right-0 after:w-px after:bg-border hover:after:w-0.5 hover:after:bg-ring"
      onPointerDown={down}
      onPointerMove={move}
      onPointerUp={up}
      onPointerCancel={up}
      onDoubleClick={onFit}
    />
  );
}

// How wide `cell` needs to be for its content not to be cut off, padding
// included: its content's widest line, measured on a hidden copy that
// takes the cell's font and wrapping.
function contentWidth(cell: HTMLTableCellElement): number {
  const probe = document.createElement("div");
  probe.style.cssText = "position: absolute; visibility: hidden; width: max-content;";
  for (const child of cell.childNodes) {
    if (!(child instanceof Element && child.getAttribute("role") === "separator")) probe.appendChild(child.cloneNode(true));
  }
  cell.appendChild(probe);
  const width = probe.getBoundingClientRect().width;
  probe.remove();
  const style = getComputedStyle(cell);
  return Math.ceil(width + Number.parseFloat(style.paddingLeft) + Number.parseFloat(style.paddingRight));
}
