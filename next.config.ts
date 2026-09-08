import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  // The V0 prototype reads local mock CSV files from the repository at runtime.
  // Nothing here talks to a network service.
  reactStrictMode: true,
};

export default nextConfig;
