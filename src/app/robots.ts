import type { MetadataRoute } from "next";

const SITE = process.env.NEXT_PUBLIC_SITE_URL || "https://techxfluence.com";

export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: "*",
      allow: "/",
      // Private / authenticated areas have nothing to index.
      disallow: [
        "/admin",
        "/host/dashboard",
        "/host/checkin",
        "/profile",
        "/account",
        "/community",
        "/directory",
        "/api/",
      ],
    },
    sitemap: `${SITE}/sitemap.xml`,
  };
}
