import path from "node:path";
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // The RTD lives in the rtd/ folder of the CRM repo. Pin the build root here
  // so Next never reaches up into the CRM's files (its postcss/Tailwind setup).
  turbopack: { root: path.resolve(__dirname) },
  outputFileTracingRoot: path.resolve(__dirname),
  // exceljs is a server-only dependency used by the Excel export route.
  serverExternalPackages: ["exceljs"],
};

export default nextConfig;
