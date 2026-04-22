import { defineHandler, defineHead } from "void";

export interface Props {}

export const loader = defineHandler<Props>(() => ({}));

const TITLE = "Blog — Spool";
const DESC =
  "Updates, technical deep-dives, and product announcements from the Spool team.";

export const head = defineHead(() => ({
  title: TITLE,
  titleTemplate: "%s",
  meta: [
    { name: "description", content: DESC },
    { property: "og:type", content: "website" },
    { property: "og:url", content: "https://spool.pro/blog/" },
    { property: "og:title", content: TITLE },
    { property: "og:description", content: DESC },
    { property: "og:image", content: "https://spool.pro/og-image.png" },
    { property: "og:site_name", content: "Spool" },
    { name: "twitter:card", content: "summary_large_image" },
    { name: "twitter:title", content: TITLE },
    { name: "twitter:description", content: DESC },
    { name: "twitter:image", content: "https://spool.pro/og-image.png" },
  ],
  link: [
    { rel: "canonical", href: "https://spool.pro/blog/" },
    { rel: "alternate", type: "application/rss+xml", title: "Spool Blog", href: "/blog/rss.xml" },
  ],
}));
