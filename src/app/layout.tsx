import type { Metadata, Viewport } from "next";
import { cookies } from "next/headers";
import { MODE_COOKIE, PALETTE_COOKIE, parseMode, parsePalette } from "@/lib/theme";
import "./globals.css";

export const metadata: Metadata = {
  title: { default: "Home Intelligence", template: "%s · Home Intelligence" },
  description:
    "Ring Home Intelligence — a concept companion app for household-aware camera notifications. Not affiliated with Amazon or Ring.",
  robots: { index: false, follow: false },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#f6f7f5" },
    { media: "(prefers-color-scheme: dark)", color: "#141716" },
  ],
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  // Appearance is a per-viewer preference kept in cookies so the first paint already has the right theme.
  const jar = await cookies();
  const palette = parsePalette(jar.get(PALETTE_COOKIE)?.value);
  const mode = parseMode(jar.get(MODE_COOKIE)?.value);
  return (
    <html lang="en" data-palette={palette} data-mode={mode}>
      <body className="min-h-screen">{children}</body>
    </html>
  );
}
