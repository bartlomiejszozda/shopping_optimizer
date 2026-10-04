import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Aisle · Your store map",
  description: "Remember product and category locations and see your shopping list on your store map.",
  other: {
    "codex-preview": "development",
  },
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
