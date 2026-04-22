import "@void/md/theme-content.css";
import { useFrontmatter } from "@void/md";
import { useRouter, Link } from "@void/react";

type NavItem = { slug: string; title: string };
type NavGroup = { label: string; items: NavItem[] };

const DOCS_NAV: NavGroup[] = [
  {
    label: "Getting Started",
    items: [
      { slug: "/docs/installation", title: "Installation" },
      { slug: "/docs/quick-start", title: "Quick Start" },
    ],
  },
  {
    label: "Guides",
    items: [
      { slug: "/docs/guides/agent-integration", title: "Agent Integration" },
      { slug: "/docs/guides/data-sources", title: "Data Sources" },
    ],
  },
  {
    label: "Reference",
    items: [
      { slug: "/docs/reference/cli", title: "CLI Commands" },
      { slug: "/docs/reference/configuration", title: "Configuration" },
    ],
  },
];

const FLAT_NAV: NavItem[] = DOCS_NAV.flatMap((g) => g.items);

export default function DocsLayout({ children }: { children: React.ReactNode }) {
  const fm = useFrontmatter();
  const { path } = useRouter();
  const currentPath = typeof path === "string" ? path.replace(/\/$/, "") : "";

  const currentIndex = FLAT_NAV.findIndex((i) => i.slug === currentPath);
  const prev = currentIndex > 0 ? FLAT_NAV[currentIndex - 1] : null;
  const next =
    currentIndex >= 0 && currentIndex < FLAT_NAV.length - 1 ? FLAT_NAV[currentIndex + 1] : null;

  return (
    <div className="docs">
      <aside className="docs-sidebar">
        {DOCS_NAV.map((group) => (
          <div className="group" key={group.label}>
            <div className="group-label">{group.label}</div>
            {group.items.map((item) => (
              <Link
                key={item.slug}
                href={item.slug}
                className={item.slug === currentPath ? "active" : ""}
              >
                {item.title}
              </Link>
            ))}
          </div>
        ))}
      </aside>
      <main className="docs-main">
        <h1>{fm.title as string}</h1>
        {typeof fm.description === "string" && fm.description && (
          <p className="docs-description">{fm.description}</p>
        )}
        <div className="void-md">{children}</div>
        <nav className="docs-pager" aria-label="Pagination">
          {prev ? (
            <Link href={prev.slug} className="prev">
              <div className="pager-label">← Previous</div>
              <div className="pager-title">{prev.title}</div>
            </Link>
          ) : (
            <span className="placeholder" />
          )}
          {next ? (
            <Link href={next.slug} className="next">
              <div className="pager-label">Next →</div>
              <div className="pager-title">{next.title}</div>
            </Link>
          ) : (
            <span className="placeholder" />
          )}
        </nav>
      </main>
    </div>
  );
}
