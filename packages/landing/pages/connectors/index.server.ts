import { defineHandler, defineHead } from "void";

export interface Props {}

export const loader = defineHandler<Props>(() => ({}));

const TITLE = "Redirecting to /daemon";

export const head = defineHead(() => ({
  title: TITLE,
  titleTemplate: "%s",
  meta: [{ name: "robots", content: "noindex" }],
  link: [{ rel: "canonical", href: "https://spool.pro/daemon" }],
}));
