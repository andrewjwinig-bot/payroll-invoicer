/** @type {import('next').NextConfig} */
const nextConfig = {
  // Keep pdfkit un-bundled so it loads from node_modules at runtime, where its
  // AFM font-metrics files live. Bundling it moves __dirname and breaks the path.
  serverExternalPackages: ["pdfkit"],

  experimental: {
    serverActions: { bodySizeLimit: "20mb" },
  },
};

export default nextConfig;
