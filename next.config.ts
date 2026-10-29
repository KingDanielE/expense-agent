import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  experimental: { serverActions: { bodySizeLimit: "10mb" } }, // receipt uploads
  serverExternalPackages: ["postgres"],
};

export default nextConfig;
