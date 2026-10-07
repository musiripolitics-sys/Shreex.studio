import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  async redirects() {
    return [
      // A friendlier alias for the TXF studio page.
      { source: "/tech-services", destination: "/Techservice", permanent: true },

      // Shreex moved out from under /admin. It was never part of the
      // Techxfluence app — /admin is Techxfluence own admin console, and the
      // platform living inside it was an accident of where it got built.
      //
      // These are not cosmetic. Task notification emails already sent link to
      // /admin/os/tasks?task=..., and an approval email links to
      // /admin/os/approvals. Those links are in people inboxes and have to
      // keep working. Next preserves the query string across a redirect, so
      // the ?task= survives.
      //
      // Temporary rather than permanent on purpose: a 308 is cached by the
      // browser indefinitely, and a path this young should stay cheap to move
      // again.
      { source: "/admin/os", destination: "/shreex", permanent: false },
      { source: "/admin/os/:path*", destination: "/shreex/:path*", permanent: false },
      { source: "/admin/platform", destination: "/shreex/platform", permanent: false },
      { source: "/admin/platform/:path*", destination: "/shreex/platform/:path*", permanent: false },
    ];
  },
};

export default nextConfig;
