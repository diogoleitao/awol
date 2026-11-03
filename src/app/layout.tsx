import type { ReactNode } from "react";
import "./globals.css";

export const metadata = {
  title: "awol",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body className="antialiased">
        <header className="flex h-14 items-center border-b px-8">
          <span className="font-semibold tracking-tight">awol</span>
        </header>
        <main className="p-8">{children}</main>
      </body>
    </html>
  );
}
