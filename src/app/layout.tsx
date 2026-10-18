import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "LeadGuard",
  description: "Unified business management platform — NASCON Team 034",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className="h-full antialiased">
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
