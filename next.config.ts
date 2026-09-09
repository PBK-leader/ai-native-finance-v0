import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  // The V0 prototype reads local mock CSV files from the repository at runtime.
  // Nothing here talks to a network service.
  reactStrictMode: true,

  // `loadRawSources` builds its paths at runtime from `process.cwd()` and a table of filenames, so Next's
  // static tracer cannot see them and would ship a server bundle with no data in it. Locally that is
  // invisible — the repository is right there. On a serverless host the first read throws ENOENT and every
  // page 500s. Naming the directory here is what makes the deployed app and the local one read the same files.
  outputFileTracingIncludes: {
    '/**': ['./data/mock/summit_mep/raw/**'],
  },
};

export default nextConfig;
