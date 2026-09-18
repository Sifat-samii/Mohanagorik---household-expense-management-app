import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "MohaNagorik — Shared Expense Management",
    short_name: "MohaNagorik",
    description: "Track shared household expenses, balances, and settlements.",
    start_url: "/",
    display: "standalone",
    background_color: "#F5F7FB",
    theme_color: "#172554",
    icons: [
      {
        src: "/brand/mohanagorik-icon-192.png",
        sizes: "192x192",
        type: "image/png",
      },
      {
        src: "/brand/mohanagorik-icon-512.png",
        sizes: "512x512",
        type: "image/png",
      },
      {
        src: "/brand/mohanagorik-icon-maskable-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "maskable",
      },
    ],
  };
}
