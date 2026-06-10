import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  eslint: { ignoreDuringBuilds: true },
  typescript: { ignoreBuildErrors: true },
  outputFileTracingRoot: process.cwd(),
  outputFileTracingIncludes: {
    '/api/status': ['./src/lib/server/legacy-server.ts'],
    '/api/dashboard': ['./src/lib/server/legacy-server.ts'],
    '/api/config': ['./src/lib/server/legacy-server.ts'],
    '/api/models': ['./src/lib/server/legacy-server.ts'],
    '/api/chat': ['./src/lib/server/legacy-server.ts'],
    '/api/llm/test': ['./src/lib/server/legacy-server.ts'],
  },
  webpack: (config, { isServer }) => {
    if (isServer) {
      config.externals.push(function ({ context, request }: any, callback: any) {
        if (request && /legacy-server/.test(request)) {
          return callback(null, 'commonjs ' + request);
        }
        callback();
      });
    }
    return config;
  },
};

export default nextConfig;
