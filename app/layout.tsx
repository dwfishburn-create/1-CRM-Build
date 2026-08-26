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
          <Link href="/dashboard" className="text-gray-600 hover:text-black">
            Dashboard
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
          <Link href="/requirements" className="text-gray-600 hover:text-black">
            Requirements
          </Link>
          <Link href="/tasks" className="text-gray-600 hover:text-black">
            Tasks
          </Link>
          <Link href="/sale-comps" className="text-gray-600 hover:text-black">
            Sale Comps
          </Link>
          <Link href="/lease-comps" className="text-gray-600 hover:text-black">
            Lease Comps
          </Link>
        </nav>
        <main className="flex-1">{children}</main>
      </body>
    </html>
  );
}
