import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // exceljs is a server-only dependency used by the Excel export route.
  serverExternalPackages: ["exceljs"],
};

export default nextConfig;
