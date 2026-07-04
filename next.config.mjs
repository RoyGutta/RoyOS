/** @type {import('next').NextConfig} */
const nextConfig = {
  // The dashboard is a pure read-only viewer over the RoyOS vault.
  // No image optimization / external hosts are needed — keep it minimal.
  reactStrictMode: true,
};

export default nextConfig;
