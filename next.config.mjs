import { fileURLToPath } from 'node:url';

/** @type {import('next').NextConfig} */
const nextConfig = {
  // There is a stray lockfile in the parent directory; pin the root explicitly.
  outputFileTracingRoot: fileURLToPath(new URL('.', import.meta.url)),
  serverExternalPackages: ['xlsx', 'pdfmake', '@prisma/client'],
  experimental: {
    serverActions: {
      // The upload is a Server Action, and those cap request bodies at 1MB by
      // default. A real monthly export is far bigger - the July file for 109
      // employees is 2.5MB - and the overflow surfaces in the browser as a bare
      // "Failed to fetch" with nothing in the server log, so this is set high
      // enough that a growing workforce does not quietly hit it again.
      bodySizeLimit: '25mb',
    },
  },
};

export default nextConfig;
