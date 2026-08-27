import createNextIntlPlugin from 'next-intl/plugin';

const withNextIntl = createNextIntlPlugin('./src/i18n/request.ts');

/**
 * Security headers per spec 8.6.
 *
 * script-src carries 'unsafe-inline' because Next.js App Router injects
 * inline bootstrap scripts on prerendered pages; there are no external script
 * hosts at all, which is the risk the CSP is really carrying. The single
 * external host pair is the OSM tile CDN, named, never wildcarded beyond its
 * own subdomains.
 */
const CSP = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: https://*.tile.openstreetmap.org https://www.myprovence.fr",
  "connect-src 'self'",
  "font-src 'self'",
  "frame-ancestors 'none'",
  "base-uri 'none'",
  "object-src 'none'",
  "form-action 'self'",
].join('; ');

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  async redirects() {
    return [{ source: '/', destination: '/fr', permanent: false }];
  },
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          { key: 'Content-Security-Policy', value: CSP },
          // WebMCP is gated on the "tools" permissions-policy feature;
          // default is self, set explicitly so an embed cannot widen it.
          { key: 'Permissions-Policy', value: 'tools=(self), geolocation=(), camera=(), microphone=()' },
          // WebMCP requires an origin-isolated document.
          { key: 'Origin-Agent-Cluster', value: '?1' },
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          { key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains' },
          // Demonstration surface, not a competing index (spec 3.2 / R7).
          { key: 'X-Robots-Tag', value: 'noindex, nofollow' },
        ],
      },
      {
        // Content-hashed artefacts: immutable. manifest.json is excluded below.
        source: '/data/:file(catalog\\..*|vocab\\..*)',
        headers: [
          { key: 'Cache-Control', value: 'public, max-age=31536000, immutable' },
        ],
      },
      {
        source: '/data/manifest.json',
        headers: [{ key: 'Cache-Control', value: 'no-cache' }],
      },
    ];
  },
};

export default withNextIntl(nextConfig);
