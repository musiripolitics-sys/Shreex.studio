import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // A friendlier alias for the TXF studio page.
  async redirects() {
    return [{ source: "/tech-services", destination: "/Techservice", permanent: true }];
  },
};

export default nextConfig;
