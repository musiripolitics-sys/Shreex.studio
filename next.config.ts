import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  async redirects() {
    return [
      // Links already in people inboxes. Task notification and approval
      // emails sent from the Techxfluence deployment point at /admin/os/...,
      // and those addresses have to keep resolving. The query string survives
      // the redirect, so ?task= still arrives.
      { source: "/admin/os", destination: "/shreex", permanent: false },
      { source: "/admin/os/:path*", destination: "/shreex/:path*", permanent: false },
      { source: "/admin/platform", destination: "/shreex/platform", permanent: false },
      { source: "/admin/platform/:path*", destination: "/shreex/platform/:path*", permanent: false },
      // /admin itself was the Techxfluence admin console and does not exist
      // here. Anyone following an old link lands on the platform instead.
      { source: "/admin", destination: "/shreex", permanent: false },
    ];
  },
};

export default nextConfig;
