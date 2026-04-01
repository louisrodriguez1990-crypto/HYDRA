import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  serverExternalPackages: ["openai"],
  turbopack: {
    root: process.cwd(),
  },
};

export default nextConfig;
