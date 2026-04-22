import { useState } from "react";
import registry from "../../data/registry.json";

type RegistryEntry = {
  name: string;
  id: string;
  platform: string;
  label: string;
  description: string;
  color: string;
  author: string;
  category: string;
  firstParty: boolean;
  npm?: string;
  packageDescription?: string;
};

type GroupedPackage = {
  name: string;
  label: string;
  color: string;
  category: string;
  author: string;
  firstParty: boolean;
  description: string;
  packageDescription?: string;
  subs: { label: string; description: string }[];
};

function groupPackages(): GroupedPackage[] {
  const connectors = registry.connectors as RegistryEntry[];
  const map = new Map<string, GroupedPackage>();

  for (const c of connectors) {
    const existing = map.get(c.name);
    if (existing) {
      existing.subs.push({ label: c.label, description: c.description });
      if (c.packageDescription && !existing.packageDescription) {
        existing.packageDescription = c.packageDescription;
      }
    } else {
      map.set(c.name, {
        name: c.name,
        label: c.label,
        color: c.color,
        category: c.category,
        author: c.author,
        firstParty: c.firstParty,
        description: c.description,
        packageDescription: c.packageDescription,
        subs: [{ label: c.label, description: c.description }],
      });
    }
  }

  for (const pkg of map.values()) {
    if (pkg.subs.length > 1) {
      const words = pkg.subs[0]!.label.split(" ");
      const common = words.filter((w) => pkg.subs.every((s) => s.label.includes(w)));
      pkg.label = common.length > 0 ? common.join(" ") : pkg.subs[0]!.label.split(" ")[0]!;
    }
  }

  return [...map.values()];
}

function subNamesOf(pkg: GroupedPackage): string[] {
  if (pkg.subs.length <= 1) return [];
  const prefix = pkg.label.trim();
  return pkg.subs.map((s) => {
    const cleaned = s.label.replace(new RegExp(`^${prefix}\\s*`, "i"), "").trim();
    return cleaned || s.label;
  });
}

function initialOf(label: string): string {
  const cleaned = label.replace(/^[^A-Za-z0-9\u4e00-\u9fa5]+/, "");
  return cleaned.charAt(0).toUpperCase() || "·";
}

export default function ConnectorsPage() {
  const packages = groupPackages();
  return (
    <main className="connectors-main">
      <h1>Connectors</h1>
      <p className="subtitle">Install connectors to index your data sources into Spool.</p>

      <div className="connectors-grid">
        {packages.map((pkg) => {
          const sourceCount = pkg.subs.length;
          const desc =
            sourceCount > 1 ? (pkg.packageDescription ?? pkg.description) : pkg.description;
          const cliCmd = `spool connector install ${pkg.name}`;
          const subNames = subNamesOf(pkg);
          return (
            <div className="c-card" key={pkg.name}>
              <div className="c-head">
                <span className="c-icon" style={{ background: pkg.color }}>
                  {initialOf(pkg.label)}
                </span>
                <div className="c-headtext">
                  <div className="c-title">{pkg.label}</div>
                  <div className="c-author">
                    {pkg.author === "spool-lab" ? "Spool Lab" : pkg.author}
                  </div>
                </div>
              </div>
              <p className="c-desc">{desc}</p>
              <div className="c-foot">
                <span className="c-meta">
                  <span className="category">{pkg.category}</span>
                  <span className="sep">·</span>
                  <span
                    className="c-sources"
                    data-sources={subNames.length ? subNames.join(" · ") : undefined}
                  >
                    {sourceCount} {sourceCount === 1 ? "source" : "sources"}
                  </span>
                </span>
                <span className="c-actions">
                  <CopyBtn cmd={cliCmd} />
                  <a
                    href={`spool://connector/install/${pkg.name}`}
                    className="c-install-btn"
                  >
                    Install
                  </a>
                </span>
              </div>
            </div>
          );
        })}
      </div>
    </main>
  );
}

function CopyBtn({ cmd }: { cmd: string }) {
  const [copied, setCopied] = useState(false);
  const onClick = async () => {
    try {
      await navigator.clipboard.writeText(cmd);
      setCopied(true);
      setTimeout(() => setCopied(false), 1400);
    } catch {}
  };
  return (
    <button
      type="button"
      className={`c-copy-btn${copied ? " copied" : ""}`}
      onClick={onClick}
      aria-label="Copy install command"
      title={copied ? "Copied!" : "Copy install command"}
    >
      {copied ? (
        <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M3.5 8.5l3 3 6-6.5" />
        </svg>
      ) : (
        <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <rect x="5" y="5" width="8" height="8" rx="1.5" />
          <path d="M3 11V4a1 1 0 0 1 1-1h7" />
        </svg>
      )}
      <span>{copied ? "Copied" : "Copy CLI"}</span>
    </button>
  );
}
