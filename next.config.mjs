import { fileURLToPath } from 'node:url';

/** @type {import('next').NextConfig} */
const nextConfig = {
  // There is a stray lockfile in the parent directory; pin the root explicitly.
  outputFileTracingRoot: fileURLToPath(new URL('.', import.meta.url)),
  serverExternalPackages: ['xlsx', 'pdfmake', '@prisma/client'],

  // This app is reachable from the internet and every page behind the login
  // shows somebody's pay. None of these change how it works; they remove ways
  // it can be used against the person signed in.
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          // Payroll screens must not be embeddable - a framed copy on another
          // site is how a signed-in session gets clicked through by proxy.
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'Content-Security-Policy', value: "frame-ancestors 'none'" },
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          // Keep employee ids and period ids out of other sites' logs.
          { key: 'Referrer-Policy', value: 'same-origin' },
          { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=(), interest-cohort=()' },
          // Only meaningful over HTTPS, which is how it is served when hosted.
          { key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains' },
        ],
      },
    ];
  },
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
