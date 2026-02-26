/** @type {import('next').NextConfig} */
const nextConfig = { experimental: { serverActions: { bodySizeLimit: '20mb' } } };
export default nextConfig;
export default { experimental: { serverActions: { allowedOrigins: [] } } };
