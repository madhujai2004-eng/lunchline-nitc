import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "LunchLine · Your break, made better",
  description: "Campus express snacks, next-day meal preorders, and a canteen vendor order desk.",
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
