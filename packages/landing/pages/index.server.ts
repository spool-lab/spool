import { defineHandler, defineHead } from "void";

export interface Props {}

export const loader = defineHandler<Props>(() => ({}));

const TITLE = "Spool — A local search engine for your thinking";
const DESC =
  "A local search engine for your thinking. Spool indexes every Claude, Codex and Gemini session — alongside your stars, bookmarks, and saves — into a single search box that lives on your machine. Your agents can search it too.";

export const head = defineHead(() => ({
  title: TITLE,
  titleTemplate: "%s",
  meta: [
    { name: "description", content: DESC },
    { property: "og:type", content: "website" },
    { property: "og:url", content: "https://spool.pro/" },
    { property: "og:title", content: TITLE },
    { property: "og:description", content: DESC },
    { property: "og:image", content: "https://spool.pro/og-image.png" },
    { property: "og:image:width", content: "1200" },
    { property: "og:image:height", content: "630" },
    { property: "og:site_name", content: "Spool" },
    { name: "twitter:card", content: "summary_large_image" },
    { name: "twitter:title", content: TITLE },
    { name: "twitter:description", content: DESC },
    { name: "twitter:image", content: "https://spool.pro/og-image.png" },
  ],
  link: [
    { rel: "canonical", href: "https://spool.pro/" },
    { rel: "alternate", type: "application/rss+xml", title: "Spool Blog", href: "/blog/rss.xml" },
  ],
  script: [
    {
      type: "application/ld+json",
      children: JSON.stringify({
        "@context": "https://schema.org",
        "@type": "SoftwareApplication",
        name: "Spool",
        description:
          "A local search engine for your thinking. Search your Claude Code sessions, Codex history, Gemini chats, GitHub stars, and 50+ sources — locally, instantly. Your AI agents can search too.",
        url: "https://spool.pro",
        applicationCategory: "DeveloperApplication",
        operatingSystem: "macOS",
        offers: { "@type": "Offer", price: "0", priceCurrency: "USD" },
        author: { "@type": "Person", name: "Yifeng", url: "https://github.com/doodlewind" },
      }),
    },
  ],
}));
