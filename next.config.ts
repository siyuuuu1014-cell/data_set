import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // parquetjs lazy-loads lzo for LZO compression, which we never use.
  // Mark parquetjs as external to skip bundling its optional deps.
  serverExternalPackages: ["parquetjs"],
  async headers() {
    return [
      {
        source: '/(.*)',
        headers: [
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
        ],
      },
    ]
  },
}

export default nextConfig;
