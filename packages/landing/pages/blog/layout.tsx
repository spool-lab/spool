import { useFrontmatter } from "@void/md";

export default function BlogLayout({ children }: { children: React.ReactNode }) {
  const fm = (useFrontmatter() ?? {}) as {
    title?: string;
    date?: string;
    author?: string;
    tags?: string[];
  };

  // If frontmatter has a date, treat as blog post and render article header.
  // Otherwise (blog index or other non-markdown pages), pass through.
  const isPost = typeof fm.date === "string" && fm.date.length > 0;

  if (!isPost) return <>{children}</>;

  const formattedDate = new Date(fm.date!).toLocaleDateString("en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
  });
  const tags = Array.isArray(fm.tags) ? fm.tags : [];

  return (
    <>
      <header className="article-header">
        <h1>{fm.title}</h1>
        <div className="article-meta">
          {fm.author && <span>{fm.author}</span>}
          <span>{formattedDate}</span>
        </div>
        {tags.length > 0 && (
          <div className="article-tags">
            {tags.map((t) => (
              <span className="tag" key={t}>
                {t}
              </span>
            ))}
          </div>
        )}
      </header>

      <article className="article-content void-md">{children}</article>

      <nav className="article-back">
        <a href="/blog">← All posts</a>
      </nav>
    </>
  );
}
