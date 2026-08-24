import type { Metadata } from "next";
import Link from "next/link";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Dan Fishburn CRM",
  description: "CBRE Omaha — internal CRM",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">
        <nav className="border-b border-gray-200 px-8 py-4 flex gap-6 items-center">
          <Link href="/" className="font-semibold">
            Dan Fishburn CRM
          </Link>
          <Link href="/contacts" className="text-gray-600 hover:text-black">
            Contacts
          </Link>
          <Link href="/properties" className="text-gray-600 hover:text-black">
            Properties
          </Link>
          <Link href="/entities" className="text-gray-600 hover:text-black">
            Entities
          </Link>
          <Link href="/projects" className="text-gray-600 hover:text-black">
            Projects
          </Link>
        </nav>
        <main className="flex-1">{children}</main>
      </body>
    </html>
  );
}
