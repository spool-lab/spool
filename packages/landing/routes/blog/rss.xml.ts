import pages from "@void/md/pages";

const SITE = "https://spool.pro";
const TITLE = "Spool Blog";
const DESC =
  "Updates, technical deep-dives, and product announcements from the Spool team.";

function escape(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

export default async () => {
  const posts = pages
    .filter((p) => p.path.startsWith("/blog/") && p.path !== "/blog")
    .map((p) => {
      const fm = (p.frontmatter ?? {}) as Record<string, unknown>;
      return {
        path: p.path,
        title: (fm.title as string) || p.title,
        description: (fm.description as string) || "",
        date: (fm.date as string) || "",
        author: (fm.author as string) || "",
        draft: Boolean(fm.draft),
      };
    })
    .filter((p) => !p.draft)
    .sort((a, b) => (a.date < b.date ? 1 : -1));

  const items = posts
    .map((p) => {
      const pubDate = p.date ? new Date(p.date).toUTCString() : new Date().toUTCString();
      return `    <item>
      <title>${escape(p.title)}</title>
      <description>${escape(p.description)}</description>
      <link>${SITE}${p.path}</link>
      <guid>${SITE}${p.path}</guid>
      <pubDate>${pubDate}</pubDate>
      ${p.author ? `<author>${escape(p.author)}</author>` : ""}
    </item>`;
    })
    .join("\n");

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0">
  <channel>
    <title>${escape(TITLE)}</title>
    <description>${escape(DESC)}</description>
    <link>${SITE}/blog/</link>
    <language>en</language>
${items}
  </channel>
</rss>`;

  return new Response(xml, {
    headers: {
      "Content-Type": "application/xml; charset=utf-8",
      "Cache-Control": "public, max-age=3600",
    },
  });
};
