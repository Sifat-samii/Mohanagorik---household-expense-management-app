import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "FairNest — Shared expenses, made fair",
  description: "Split household bills, track balances, and settle up without the spreadsheet chaos.",
  icons: {
    icon: "/favicon.svg",
    shortcut: "/favicon.svg",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className="antialiased">{children}</body>
    </html>
  );
}
