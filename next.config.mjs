/** @type {import('next').NextConfig} */
const nextConfig = {
  // Local-only single-user dashboard; no image optimization or external hosts.
  reactStrictMode: true,
  async headers() {
    return [{
      source: "/:path*",
      headers: [
        // Next's dev/runtime scripts need inline/eval; the value that matters here is frame-ancestors (clickjacking of Approve/Deploy)
        { key: "Content-Security-Policy", value: "default-src 'self'; script-src 'self' 'unsafe-inline' 'unsafe-eval'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; media-src 'self' blob:; connect-src 'self'; font-src 'self' data:; frame-ancestors 'none'; base-uri 'self'; form-action 'self'" },
        { key: "X-Frame-Options", value: "DENY" },
        { key: "X-Content-Type-Options", value: "nosniff" },
        { key: "Referrer-Policy", value: "no-referrer" },
        { key: "Permissions-Policy", value: "camera=(), geolocation=(), payment=(), usb=()" },
      ],
    }];
  },
};

export default nextConfig;
