import type { ReactNode } from "react";
import "./globals.css";
import { LiveUpdates } from "./live-updates.tsx";
import { TopBar } from "./top-bar.tsx";

export const metadata = {
  title: "awol",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body className="antialiased">
        <TopBar />
        <main className="p-8">{children}</main>
        <LiveUpdates />
      </body>
    </html>
  );
}
