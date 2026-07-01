import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // parquetjs lazy-loads lzo for LZO compression, which we never use.
  // Point it to a stub to avoid build resolution errors.
  turbopack: {
    resolveAlias: {
      lzo: "./lib/lzo-stub.js",
    },
  },
};

export default nextConfig;
