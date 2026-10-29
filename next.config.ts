import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  experimental: { serverActions: { bodySizeLimit: "10mb" } }, // receipt uploads
  serverExternalPackages: ["postgres"],
  // Read at runtime with dynamic paths, so tell the bundler to ship them with every function.
  outputFileTracingIncludes: {
    "/**/*": ["./data/receipts/**/*", "./prompts/**/*", "./policy/**/*"],
  },
};

export default nextConfig;
