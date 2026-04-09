import type { Metadata } from "next";
import { Inter } from "next/font/google";
import { SkipLink } from "@/components/shared/skip-link";
import "./globals.css";

const inter = Inter({ subsets: ["latin"], variable: "--font-inter" });

export const metadata: Metadata = {
  title: "ShossyWorks",
  description: "Construction estimating platform by Szostak Build, LLC",
  openGraph: {
    title: "ShossyWorks",
    description: "Construction estimating platform",
    type: "website",
  },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${inter.variable} h-full`}>
      <body className="min-h-full font-sans antialiased">
        <SkipLink />
        <div id="main-content">{children}</div>
      </body>
    </html>
  );
}
