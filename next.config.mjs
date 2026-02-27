/** @type {import('next').NextConfig} */
const nextConfig = {
  experimental: {
    serverActions: { bodySizeLimit: "20mb" },

    // Ensure PDFKit built-in font metrics (data/*.afm) are bundled in Vercel.
    // This fixes: ENOENT .../data/Helvetica.afm
    outputFileTracingIncludes: {
      "/app/api/generate-all/route": [
        "./node_modules/pdfkit/js/data/**",
        "./node_modules/pdfkit/js/data/**/*",
      ],
    },
  },
};

export default nextConfig;
