import pages from "@void/md/pages";
import { Link } from "@void/react";

type PostMeta = {
  path: string;
  title: string;
  description?: string;
  date: string;
  author?: string;
  tags: string[];
};

function collectPosts(): PostMeta[] {
  return pages
    .filter((p) => p.path.startsWith("/blog/") && p.path !== "/blog")
    .map((p) => {
      const fm = (p.frontmatter ?? {}) as Record<string, unknown>;
      return {
        path: p.path,
        title: (fm.title as string) || p.title,
        description: fm.description as string | undefined,
        date: (fm.date as string) || "",
        author: fm.author as string | undefined,
        tags: Array.isArray(fm.tags) ? (fm.tags as string[]) : [],
        draft: Boolean(fm.draft),
      };
    })
    .filter((p) => !(p as PostMeta & { draft: boolean }).draft)
    .sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
}

export default function BlogIndex() {
  const posts = collectPosts();
  return (
    <>
      <header className="blog-header">
        <h1>Blog</h1>
        <p>Updates, technical deep-dives, and product announcements.</p>
      </header>
      <main className="posts">
        {posts.length === 0 && <div className="empty">No posts yet. Check back soon.</div>}
        {posts.map((post) => {
          const formattedDate = post.date
            ? new Date(post.date).toLocaleDateString("en-US", {
                year: "numeric",
                month: "short",
                day: "numeric",
              })
            : "";
          return (
            <Link href={post.path} className="post-card" key={post.path}>
              <h2>{post.title}</h2>
              {post.description && <p>{post.description}</p>}
              <div className="post-meta">
                {post.author && <span>{post.author}</span>}
                {formattedDate && <span>{formattedDate}</span>}
                {post.tags.length > 0 && (
                  <div className="post-tags">
                    {post.tags.map((t) => (
                      <span className="tag" key={t}>
                        {t}
                      </span>
                    ))}
                  </div>
                )}
              </div>
            </Link>
          );
        })}
      </main>
    </>
  );
}
