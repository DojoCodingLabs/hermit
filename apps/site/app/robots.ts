// robots.txt: everything may be crawled, and the sitemap is on joinhermit.com. Written once at build time.
import type { MetadataRoute } from "next";
import { SITE_URL } from "../lib/site-config.mjs";

export const dynamic = "force-static";

export default function robots(): MetadataRoute.Robots {
  return { rules: { userAgent: "*", allow: "/" }, sitemap: `${SITE_URL}/sitemap.xml` };
}
