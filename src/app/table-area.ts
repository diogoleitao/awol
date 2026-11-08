// The classes of the area of a table and what sits right under it, such as
// its pager, which on wide screens is as tall as what is left beside a
// `SidebarLayout`'s sidebar but never under 20rem: below that, the page
// beside the sidebar scrolls instead. Its table needs `SCROLLING_TABLE` and
// a header with `STICKY_HEADER`.
export const TABLE_AREA = "lg:flex lg:min-h-80 lg:flex-col";

// The classes of a table's container in a `TABLE_AREA` that scrolls the
// table's rows on its own, as tall as its rows up to what the area leaves
// it, so that what sits under it follows its last row.
export const SCROLLING_TABLE = "lg:min-h-0 lg:overflow-auto";

// The classes of a table's header that stays at the top of its
// `SCROLLING_TABLE`, keeping the line under it, which a collapsed border
// would leave behind.
export const STICKY_HEADER = "lg:sticky lg:top-0 lg:z-10 lg:bg-background lg:[&_th]:shadow-[inset_0_-1px_0_var(--border)]";
