import { defineConfig } from "vite";
import { voidPlugin } from "void";
import { voidReact } from "@void/react/plugin";
import { voidMarkdown } from "@void/md/plugin";

export default defineConfig({
  plugins: [voidPlugin(), voidReact(), voidMarkdown()],
});
