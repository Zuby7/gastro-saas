import type { Metadata } from "next";
import { Geist, Roboto_Slab, Space_Mono } from "next/font/google";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

// Display/heading face for the design pass v2 (see packages/ui/src/tokens.ts
// for the full rationale) — a structural slab serif that reads like diner/
// menu-board signage, replacing the previous soft-serif (Fraunces), kept
// separate from the body face (Geist Sans) for a clear type hierarchy.
const robotoSlab = Roboto_Slab({
  variable: "--font-roboto-slab",
  subsets: ["latin"],
  weight: ["400", "600", "700"],
});

// Utility/ticket face, used ONLY for order numbers/status codes/ticket
// badges (see the "ticket-edge" signature element in globals.css) — a
// typewriter-style monospace that reinforces the receipt/order-chit
// metaphor. Deliberately not used for running text or code.
const spaceMono = Space_Mono({
  variable: "--font-space-mono",
  subsets: ["latin"],
  weight: ["400", "700"],
});

export const metadata: Metadata = {
  title: "gastro-saas",
  description: "Multi-tenant SaaS platform for independent gastronomy businesses.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="de"
      className={`${geistSans.variable} ${spaceMono.variable} ${robotoSlab.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
