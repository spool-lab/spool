import { useEffect, useRef, useState } from "react";

const PHRASES = [
  "refresh token rotation",
  "how did we fix the 3am cookie bug",
  "local-first sync approaches",
  "what did I ship last week",
  "build on last month\u2019s caching talk",
];

const TICKER_ITEMS = [
  { name: "Claude Code", color: "var(--src-claude)", count: "342" },
  { name: "Codex CLI", color: "var(--src-codex)", count: "57" },
  { name: "Gemini CLI", color: "var(--src-gemini)", count: "41" },
  { name: "ChatGPT", color: "var(--src-chatgpt)", count: "128" },
  { name: "GitHub Stars", color: "var(--src-github)", count: "1.2k" },
  { name: "Twitter / X", color: "var(--src-twitter)", count: "891" },
  { name: "YouTube", color: "var(--src-youtube)", count: "64" },
  { name: "Reddit", color: "#FF4500", count: "203" },
  { name: "Substack", color: "#FF6719", count: "48" },
  { name: "LinkedIn", color: "#0A66C2", count: "19" },
  { name: "Hypothesis", color: "#BD1C2B", count: "112" },
  { name: "Readwise", color: "#888", count: "380" },
];

const INSTALL_CMD = "curl -fsSL https://spool.pro/install.sh | bash";

const SearchIcon = ({ className, size = 16 }: { className?: string; size?: number }) => (
  <svg
    className={className}
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <circle cx="11" cy="11" r="8" />
    <path d="m21 21-4.3-4.3" />
  </svg>
);

export default function HomePage() {
  return (
    <>
      <main className="wrap">
        <div className="hero">
          <HeroLeft />
          <Specimen />
        </div>
      </main>

      <Ticker />

      <main className="wrap">
        <GallerySection />
        <AgentSection />
        <SourcesSection />
        <PrinciplesSection />
        <FinalCTA />
      </main>
    </>
  );
}

function HeroLeft() {
  return (
    <div className="hero-left">
      <div className="eyebrow">
        <span className="pulse" /> v0.3 · local-first · macOS
      </div>
      <h1 className="display">
        A local
        <br />
        search engine
        <br />
        for your
        <br />
        <em>
          thinking<span className="accent">.</span>
        </em>
      </h1>
      <p className="lede">
        Spool quietly indexes every Claude, Codex and Gemini session you've ever had — alongside
        your stars, bookmarks, and saves — into a single search box that lives on your machine. Your
        agents can search it too.
      </p>

      <div className="cta-row">
        <InstallPill />
        <a href="https://github.com/spool-lab/spool" className="btn primary">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
            <path d="M12 .3a12 12 0 0 0-3.8 23.4c.6.1.8-.3.8-.6v-2c-3.3.7-4-1.6-4-1.6-.5-1.4-1.3-1.8-1.3-1.8-1.1-.7.1-.7.1-.7 1.2.1 1.8 1.2 1.8 1.2 1.1 1.8 2.8 1.3 3.5 1 .1-.8.4-1.3.8-1.6-2.7-.3-5.5-1.3-5.5-5.9 0-1.3.5-2.3 1.2-3.2-.1-.3-.5-1.5.1-3.2 0 0 1-.3 3.3 1.2a11.5 11.5 0 0 1 6 0C17.3 4.7 18.3 5 18.3 5c.7 1.7.2 2.9.1 3.2.8.9 1.2 1.9 1.2 3.2 0 4.6-2.8 5.6-5.5 5.9.4.4.8 1.1.8 2.2v3.3c0 .3.2.7.8.6A12 12 0 0 0 12 .3" />
          </svg>
          Star on GitHub
        </a>
      </div>

      <div className="meta-row">
        <span>MIT</span>
        <span className="dotsep" />
        <span>Apple Silicon</span>
        <span className="dotsep" />
        <span>Built in the open</span>
      </div>
    </div>
  );
}

function InstallPill() {
  const [copied, setCopied] = useState(false);
  const onClick = () => {
    navigator.clipboard.writeText(INSTALL_CMD).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    });
  };
  return (
    <button
      type="button"
      className={`install${copied ? " copied" : ""}`}
      onClick={onClick}
      aria-label="Copy install command"
    >
      <span className="tick">$</span>
      <code>{INSTALL_CMD}</code>
      <span className="copy">
        {copied ? (
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="20 6 9 17 4 12" />
          </svg>
        ) : (
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
            <rect x="9" y="9" width="13" height="13" rx="2" />
            <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
          </svg>
        )}
      </span>
    </button>
  );
}

function Specimen() {
  return (
    <div className="specimen">
      <div className="s-top">
        <div className="tl">
          <span />
          <span />
          <span />
        </div>
        <div className="s-title-bar">spool · 720 × 480</div>
      </div>

      <div className="s-bar">
        <SearchIcon className="search" />
        <span className="typed">
          <TypedPhrases />
          <span className="caret" />
        </span>
        <span className="mode active">Fast</span>
        <span className="mode">AI</span>
      </div>

      <div className="s-results">
        <div className="s-row sel">
          <span className="dot" style={{ background: "var(--src-claude)" }} />
          <div className="rtxt">
            <div className="rtitle">
              auth-middleware — <mark>cookie-based refresh</mark> with rotation
            </div>
            <div className="rmeta">You discussed this · Mar 15 · 42 msgs · ~/projects/api-core</div>
          </div>
          <span className="rkey">↵</span>
        </div>
        <div className="s-row">
          <span className="dot" style={{ background: "var(--src-claude)" }} />
          <div className="rtxt">
            <div className="rtitle">
              <mark>express-jwt</mark> rotation edge cases
            </div>
            <div className="rmeta">You discussed this · Mar 12 · 18 msgs</div>
          </div>
          <span className="rkey">↓</span>
        </div>
        <div className="s-row">
          <span className="dot" style={{ background: "var(--src-github)" }} />
          <div className="rtxt">
            <div className="rtitle">
              benvinegar/counterscale — <mark>refresh-token</mark> patterns
            </div>
            <div className="rmeta">You starred this · Feb 8 · 2.1k ★</div>
          </div>
          <span className="rkey">↓</span>
        </div>
        <div className="s-row">
          <span className="dot" style={{ background: "var(--src-twitter)" }} />
          <div className="rtxt">
            <div className="rtitle">
              @thdxr · "rotating <mark>refresh</mark> tokens is harder than it looks…"
            </div>
            <div className="rmeta">You saved this · Jan 22</div>
          </div>
          <span className="rkey">↓</span>
        </div>
        <div className="s-row">
          <span className="dot" style={{ background: "var(--src-codex)" }} />
          <div className="rtxt">
            <div className="rtitle">
              codex · <mark>session refresh</mark> implementation spike
            </div>
            <div className="rmeta">You discussed this · Jan 09</div>
          </div>
          <span className="rkey">↓</span>
        </div>
      </div>

      <div className="s-foot">
        <span>
          <span className="statusdot" />
          2,847 items indexed · 12 sources
        </span>
        <span>synced 14s ago</span>
      </div>
    </div>
  );
}

function TypedPhrases() {
  const [text, setText] = useState("");
  const stateRef = useRef({ phrase: 0, char: 0, deleting: false, pause: 0 });
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>;
    const tick = () => {
      const s = stateRef.current;
      const phrase = PHRASES[s.phrase]!;
      if (s.pause > 0) {
        s.pause--;
        timer = setTimeout(tick, 28);
        return;
      }
      if (!s.deleting) {
        setText(phrase.substring(0, s.char + 1));
        s.char++;
        if (s.char === phrase.length) {
          s.deleting = true;
          s.pause = 70;
        }
      } else {
        setText(phrase.substring(0, s.char - 1));
        s.char--;
        if (s.char === 0) {
          s.deleting = false;
          s.phrase = (s.phrase + 1) % PHRASES.length;
          s.pause = 12;
        }
      }
      timer = setTimeout(tick, s.deleting ? 22 : 55 + Math.random() * 40);
    };
    tick();
    return () => clearTimeout(timer);
  }, []);
  return <span>{text}</span>;
}

function Ticker() {
  const items = [...TICKER_ITEMS, ...TICKER_ITEMS];
  return (
    <div className="ticker">
      <span className="label">· Indexed locally</span>
      <div className="ticker-track">
        {items.map((item, i) => (
          <span className="ticker-item" key={i}>
            <span className="ico">
              <span
                style={{
                  width: 8,
                  height: 8,
                  borderRadius: "50%",
                  background: item.color,
                  display: "inline-block",
                }}
              />
            </span>
            {item.name}
            <span className="count">{item.count}</span>
          </span>
        ))}
      </div>
    </div>
  );
}

function GallerySection() {
  return (
    <section id="gallery">
      <div className="s-head">
        <div className="s-num">
          <span className="line" />
          01 · QUERIES
        </div>
        <div>
          <h2 className="s-title">
            The things you <em>almost</em> remembered<span className="accent">.</span>
          </h2>
          <p className="s-sub">
            Five months of AI sessions. Three tabs of bookmarks. Every week another starred repo.
            Spool takes all of it and answers the question you can only half-formulate — in
            monospace, with receipts.
          </p>
        </div>
      </div>

      <div className="queries">
        <QCard
          query="the claude session where I fixed the auth bug"
          mode="fast"
          results={[
            {
              color: "var(--src-claude)",
              title: (
                <>
                  <mark>auth-middleware</mark> — jwt rotation fix
                </>
              ),
              meta: "You discussed this · Mar 15 · 42 msgs",
              src: "claude",
              srcColor: "var(--src-claude)",
              srcPct: 16,
            },
            {
              color: "var(--src-claude)",
              title: (
                <>
                  auth spike — "why does the <mark>cookie expire at 3am</mark>"
                </>
              ),
              meta: "You discussed this · Mar 11 · 8 msgs",
              src: "claude",
              srcColor: "var(--src-claude)",
              srcPct: 16,
            },
          ]}
        />
        <QCard
          query="what was that post about local-first sync?"
          mode="fast"
          results={[
            {
              color: "var(--src-twitter)",
              title: (
                <>
                  @geoffreylitt — "<mark>local-first</mark> is finally boring, in a good way"
                </>
              ),
              meta: "You saved this · Feb 04",
              src: "twitter",
              srcColor: "var(--src-twitter)",
              srcPct: 20,
            },
            {
              color: "var(--src-github)",
              title: (
                <>
                  automerge/automerge — CRDT <mark>sync</mark> library
                </>
              ),
              meta: "You starred this · Jan 18 · 3.4k ★",
              src: "github",
              srcColor: "var(--src-github)",
              srcPct: 20,
            },
          ]}
        />
        <QCard
          query="what did I ship last week"
          mode="ai"
          results={[
            {
              color: "var(--accent)",
              ai: true,
              title: (
                <>
                  Three features across <em>api-core</em> and <em>billing</em>:{" "}
                  <mark>jwt rotation</mark>, stripe webhook retries, and the admin-audit middleware.
                  Eight Claude sessions, two PRs.
                </>
              ),
              meta: "Claude says · via ACP · local · 8 fragments",
              src: "ai",
              srcColor: "var(--accent)",
              srcBg: "var(--accent-bg)",
            },
          ]}
        />
        <QCard
          query="repos I starred about RAG pipelines"
          mode="fast"
          results={[
            {
              color: "var(--src-github)",
              title: (
                <>
                  run-llama/llama_index — <mark>RAG</mark> orchestration
                </>
              ),
              meta: "You starred this · Mar 02 · 34.8k ★",
              src: "github",
              srcColor: "var(--src-github)",
              srcPct: 20,
            },
            {
              color: "var(--src-github)",
              title: <>chroma-core/chroma — embedding store</>,
              meta: "You starred this · Feb 19 · 12.1k ★",
              src: "github",
              srcColor: "var(--src-github)",
              srcPct: 20,
            },
          ]}
        />
        <QCard
          query="build on last month's caching discussion"
          mode="ai"
          results={[
            {
              color: "var(--accent)",
              ai: true,
              title: (
                <>
                  We landed on a <mark>stale-while-revalidate</mark> strategy with Redis, 90s ttl,
                  keyed on user-scope — see{" "}
                  <code style={{ fontFamily: "'Geist Mono'", fontSize: "11.5px" }}>
                    cache-layer.md
                  </code>
                  .
                </>
              ),
              meta: "Claude says · via ACP · local · 3 fragments",
              src: "ai",
              srcColor: "var(--accent)",
              srcBg: "var(--accent-bg)",
            },
          ]}
        />
        <QCard
          query="that YouTube talk about B+ trees"
          mode="fast"
          results={[
            {
              color: "var(--src-youtube)",
              title: (
                <>
                  CMU Database Group — "<mark>B+ trees</mark> in practice"
                </>
              ),
              meta: "You liked this · Jan 30 · 1:14:22",
              src: "youtube",
              srcColor: "var(--src-youtube)",
              srcPct: 18,
            },
            {
              color: "var(--src-youtube)",
              title: <>Andy Pavlo — intro to DB internals lecture 04</>,
              meta: "You liked this · Dec 21 · 58:10",
              src: "youtube",
              srcColor: "var(--src-youtube)",
              srcPct: 18,
            },
          ]}
        />
      </div>
    </section>
  );
}

type QResult = {
  color: string;
  title: React.ReactNode;
  meta: string;
  src: string;
  srcColor: string;
  srcPct?: number;
  srcBg?: string;
  ai?: boolean;
};

function QCard({ query, mode, results }: { query: string; mode: "fast" | "ai"; results: QResult[] }) {
  return (
    <div className="qcard">
      <div className="qhead">
        <SearchIcon size={13} />
        <span className="qtxt">{query}</span>
        <span className={`qkey${mode === "ai" ? " ai" : ""}`}>{mode}</span>
      </div>
      {results.map((r, i) => {
        const srcStyle = r.srcBg
          ? { background: r.srcBg, color: r.srcColor }
          : {
              background: `color-mix(in srgb, ${r.srcColor} ${r.srcPct ?? 18}%, transparent)`,
              color: r.srcColor,
            };
        return (
          <div className="qres" key={i}>
            <span className="qdot" style={{ background: r.color }} />
            <div className="qbody">
              <div className={`qtitle${r.ai ? " ai" : ""}`}>{r.title}</div>
              <div className="qmeta">{r.meta}</div>
            </div>
            <span className="qsrc" style={srcStyle}>
              {r.src}
            </span>
          </div>
        );
      })}
    </div>
  );
}

function AgentSection() {
  return (
    <section id="agents">
      <div className="s-head">
        <div className="s-num">
          <span className="line" />
          02 · AGENTS
        </div>
        <div>
          <h2 className="s-title">
            Your agent is already your best <em>search engine</em> — once it can read you
            <span className="accent">.</span>
          </h2>
          <p className="s-sub">
            The <code>/spool</code> skill gives Claude Code, Codex, Gemini CLI — any ACP agent — a
            way to search your personal index mid-conversation. No cloud round-trip. No copy-paste.
            Just context flowing back in.
          </p>
        </div>
      </div>

      <div className="agent">
        <div className="notes">
          <div>
            <h3>01 — Ask what it ought to know.</h3>
            <p>
              "Build on the auth middleware discussion from last week." The agent invokes{" "}
              <code>/spool</code>, Spool searches your index, and fragments flow back into the
              conversation window.
            </p>
          </div>
          <div>
            <h3>02 — Every source equally first-class.</h3>
            <p>
              A starred repo, a saved tweet, an old Codex run — all retrievable by the same search.
              The agent doesn't care what platform it came from; neither should you.
            </p>
          </div>
          <div>
            <h3>03 — The trust label is load-bearing.</h3>
            <p>
              Every answer is stamped <code>via ACP · local</code>. Inference runs where you are.
              Your thinking is never the product.
            </p>
          </div>
        </div>

        <div className="term">
          <div className="line">
            <span className="p">$</span> <span className="you">claude</span>
          </div>
          <div className="line" style={{ marginTop: 10 }}>
            <span className="sys">&gt;</span> <span>build on the auth middleware</span>
          </div>
          <div className="line">
            <span className="sys">&gt;</span> <span>discussion from last week</span>
          </div>

          <div className="out">
            <div className="line">
              <span className="sys">◉</span>{" "}
              <span className="sys">/spool — searching your index…</span>
            </div>
            <div className="frag">
              <span
                className="tag"
                style={{
                  background: "color-mix(in srgb, var(--src-claude) 20%, transparent)",
                  color: "var(--src-claude)",
                }}
              >
                claude
              </span>
              <span className="path">auth-middleware-rewrite</span>
              <span className="when">Mar 15</span>
            </div>
            <div className="frag">
              <span
                className="tag"
                style={{
                  background: "color-mix(in srgb, var(--src-github) 20%, transparent)",
                  color: "var(--src-github)",
                }}
              >
                github
              </span>
              <span className="path">express-jwt · refresh flow</span>
              <span className="when">Feb 08</span>
            </div>
            <div className="frag">
              <span
                className="tag"
                style={{
                  background: "color-mix(in srgb, var(--src-twitter) 20%, transparent)",
                  color: "var(--src-twitter)",
                }}
              >
                twitter
              </span>
              <span className="path">@thdxr on jwt rotation</span>
              <span className="when">Jan 22</span>
            </div>
          </div>

          <div className="inject">→ 3 fragments loaded into context. via ACP · local</div>
        </div>
      </div>
    </section>
  );
}

const SOURCES = [
  { name: "Claude Code", color: "var(--src-claude)", kind: "Sessions", count: "342", cadence: "watched · realtime" },
  { name: "Codex CLI", color: "var(--src-codex)", kind: "Sessions", count: "57", cadence: "watched · realtime" },
  { name: "Gemini CLI", color: "var(--src-gemini)", kind: "Sessions", count: "41", cadence: "watched · realtime" },
  { name: "ChatGPT", color: "var(--src-chatgpt)", kind: "Export", count: "128", cadence: "synced · weekly" },
  { name: "GitHub", color: "var(--src-github)", kind: "Stars", count: "1,214", cadence: "synced · hourly" },
  { name: "Twitter / X", color: "var(--src-twitter)", kind: "Bookmarks", count: "891", cadence: "synced · daily" },
  { name: "YouTube", color: "var(--src-youtube)", kind: "Likes", count: "64", cadence: "synced · daily" },
  { name: "Reddit", color: "#FF4500", kind: "Saved", count: "203", cadence: "synced · daily" },
];

function SourcesSection() {
  return (
    <section id="sources">
      <div className="s-head">
        <div className="s-num">
          <span className="line" />
          03 · SOURCES
        </div>
        <div>
          <h2 className="s-title">
            Connectors pull everything home<span className="accent">.</span>
          </h2>
          <p className="s-sub">
            Each platform has an installable connector plugin that syncs what you've saved, starred,
            liked or had a conversation with — straight into Spool's local index. Nothing leaves the
            machine.
          </p>
        </div>
      </div>

      <div className="sources-grid">
        {SOURCES.map((s) => (
          <div className="src-cell" key={s.name}>
            <div className="topline">
              <div className="srcname">
                <span className="swatch" style={{ background: s.color }} />
                {s.name}
              </div>
              <div className="srckind">{s.kind}</div>
            </div>
            <div className="srcmeta">
              <span className="count">{s.count}</span>
              <span>{s.cadence}</span>
            </div>
          </div>
        ))}
        <a href="/connectors" className="src-cell add">
          <div className="topline">
            <div className="srcname" style={{ color: "var(--text)" }}>
              <span className="plus">+</span> &nbsp;Browse connectors
            </div>
            <div className="srckind">42 more</div>
          </div>
          <div className="srcmeta">
            <span>Substack · LinkedIn · Hypothesis · Readwise · Raindrop · Pocket · …</span>
          </div>
        </a>
      </div>
    </section>
  );
}

function PrinciplesSection() {
  const principles = [
    { n: "i.", title: "Local, always.", body: "Your index, your embeddings, your queries — all on-device. Nothing is uploaded to sync a \"cloud profile.\" There is no cloud profile." },
    { n: "ii.", title: "Search is the interface.", body: "Not a sidebar. Not a dashboard. One box, one input, instant results — the shape of the product is the shape of the question." },
    { n: "iii.", title: "First-person metadata.", body: "\"You discussed this\" beats \"Claude Code · Mar 15.\" The archive is yours; the language should say so." },
    { n: "iv.", title: "Agents are citizens.", body: "A search engine humans can use and agents can query reaches a different ceiling. Spool is both from day one." },
  ];
  return (
    <section>
      <div className="s-head">
        <div className="s-num">
          <span className="line" />
          04 · PRINCIPLES
        </div>
        <div>
          <h2 className="s-title">
            Rules of the <em>house</em><span className="accent">.</span>
          </h2>
        </div>
      </div>

      <div className="principles">
        {principles.map((p) => (
          <div className="principle" key={p.n}>
            <div className="p-num">{p.n}</div>
            <h4>{p.title}</h4>
            <p>{p.body}</p>
          </div>
        ))}
      </div>
    </section>
  );
}

function FinalCTA() {
  return (
    <section className="final">
      <div className="big">
        Your thinking,
        <br />
        <em>searchable</em>
        <span className="accent">.</span>
      </div>
      <div className="row">
        <InstallPill />
        <a href="https://github.com/spool-lab/spool" className="btn primary">
          Star on GitHub
        </a>
        <a href="/docs/installation" className="btn">
          Read the docs →
        </a>
      </div>
      <div className="plat">macOS · Apple Silicon · MIT · Built in the open</div>
    </section>
  );
}
