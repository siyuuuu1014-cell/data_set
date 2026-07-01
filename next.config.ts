import type { NextConfig } from "next";
import path from "path";

const nextConfig: NextConfig = {
  // parquetjs lazy-loads lzo for LZO compression, which we never use.
  // Mark parquetjs as external to skip bundling its optional deps.
  serverExternalPackages: ["parquetjs"],
};

export default nextConfig;
