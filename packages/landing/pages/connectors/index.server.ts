import { defineHandler, defineHead } from "void";

export interface Props {}

export const loader = defineHandler<Props>(() => ({}));

const TITLE = "Connectors — Spool";
const DESC = "Browse and install Spool connectors to index your data sources.";

export const head = defineHead(() => ({
  title: TITLE,
  titleTemplate: "%s",
  meta: [
    { name: "description", content: DESC },
    { property: "og:type", content: "website" },
    { property: "og:url", content: "https://spool.pro/connectors" },
    { property: "og:title", content: TITLE },
    { property: "og:description", content: DESC },
    { property: "og:image", content: "https://spool.pro/og-image.png" },
    { property: "og:site_name", content: "Spool" },
  ],
  link: [{ rel: "canonical", href: "https://spool.pro/connectors" }],
}));
