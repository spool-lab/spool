import { defineHandler, defineHead } from "void";

export interface Props {}

export const loader = defineHandler<Props>(() => ({}));

const TITLE = "Spool Daemon — Background sync for your captures";
const DESC =
  "A standalone app that quietly pulls your stars, bookmarks, saves and notes into a local SQLite database. Search captures from its own UI, or pair with Spool. Plugins for the platforms you care about. Nothing leaves the machine.";

export const head = defineHead(() => ({
  title: TITLE,
  titleTemplate: "%s",
  meta: [
    { name: "description", content: DESC },
    { property: "og:type", content: "website" },
    { property: "og:url", content: "https://spool.pro/daemon" },
    { property: "og:title", content: TITLE },
    { property: "og:description", content: DESC },
    { property: "og:image", content: "https://spool.pro/og-image.png" },
    { property: "og:site_name", content: "Spool" },
  ],
  link: [{ rel: "canonical", href: "https://spool.pro/daemon" }],
}));
