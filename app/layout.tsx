import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "MohaNagorik — Shared expenses, made fair",
  description: "Split household bills, track balances, and settle up without the spreadsheet chaos.",
  applicationName: "MohaNagorik",
  manifest: "/manifest.webmanifest",
  icons: {
    icon: [
      { url: "/favicon.ico", sizes: "32x32" },
      { url: "/brand/mohanagorik-icon-64.png", type: "image/png", sizes: "64x64" },
    ],
    shortcut: "/favicon.ico",
    apple: "/brand/mohanagorik-icon-180.png",
  },
};

export const viewport: Viewport = {
  themeColor: "#172554",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head><script dangerouslySetInnerHTML={{__html:`try{var t=localStorage.getItem("mohanagorik-theme")==="dark"?"dark":"light";document.documentElement.dataset.theme=t;document.documentElement.classList.toggle("dark",t==="dark");document.documentElement.style.colorScheme=t}catch(e){}`}}/></head>
      <body className="antialiased">{children}</body>
    </html>
  );
}
