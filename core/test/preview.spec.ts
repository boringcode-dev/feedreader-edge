import { describe, expect, it } from "vitest";
import {
  extractArticlePreview,
  fetchArticlePreview,
  normalizePreviewUrl,
  PreviewUnavailableError,
} from "../preview.ts";

const ARTICLE_HTML = `<!doctype html>
<html>
  <head>
    <title>Understanding Edge Computing | Example Blog</title>
    <meta property="og:site_name" content="Example Blog" />
    <meta name="author" content="Jane Doe" />
    <meta name="description" content="A practical look at edge runtimes." />
  </head>
  <body>
    <header><nav>Home About Subscribe</nav></header>
    <main>
      <article>
        <h1>Understanding Edge Computing</h1>
        <p>Edge computing moves computation closer to users, cutting round trips and keeping data regional.</p>
        <h2>Why it matters</h2>
        <p>Latency and locality are the main reasons teams care about edge runtimes today.</p>
        <ul>
          <li>Lower latency</li>
          <li>Regional data handling</li>
        </ul>
        <blockquote>Edge is a deployment strategy, not an architecture.</blockquote>
        <pre>const edge = true;</pre>
        <script>alert("xss")</script>
      </article>
      <aside>Related posts you may like</aside>
    </main>
    <footer>Copyright Example 2026</footer>
  </body>
</html>`;

describe("normalizePreviewUrl", () => {
  it("accepts a public http(s) article URL", () => {
    expect(normalizePreviewUrl("https://example.com/posts/edge")).toBe(
      "https://example.com/posts/edge",
    );
    expect(normalizePreviewUrl("http://example.com/")).toBe(
      "http://example.com/",
    );
  });

  it("rejects non-http protocols and credentials", () => {
    expect(normalizePreviewUrl("javascript:alert(1)")).toBeNull();
    expect(normalizePreviewUrl("file:///etc/passwd")).toBeNull();
    expect(normalizePreviewUrl("ftp://example.com/file")).toBeNull();
    expect(normalizePreviewUrl("https://user:pass@example.com/")).toBeNull();
  });

  it("rejects loopback, private, and link-local hosts", () => {
    for (const url of [
      "http://localhost/",
      "http://app.localhost/",
      "http://printer.local/",
      "http://127.0.0.1/",
      "http://10.1.2.3/",
      "http://172.16.0.1/",
      "http://192.168.1.1/",
      "http://169.254.169.254/latest/meta-data",
      "http://0.0.0.0/",
      "http://[::1]/",
      "http://[fe80::1]/",
    ]) {
      expect(normalizePreviewUrl(url), url).toBeNull();
    }
  });

  it("rejects non-standard ports", () => {
    expect(normalizePreviewUrl("https://example.com:8443/post")).toBeNull();
    expect(normalizePreviewUrl("http://example.com:80/post")).toBe(
      "http://example.com/post",
    );
  });

  it("accepts a public IP literal", () => {
    expect(normalizePreviewUrl("https://93.184.216.34/post")).toBe(
      "https://93.184.216.34/post",
    );
  });
});

describe("extractArticlePreview", () => {
  it("extracts title, metadata, and readable blocks without page noise", () => {
    const preview = extractArticlePreview(
      ARTICLE_HTML,
      "https://example.com/edge",
    );

    expect(preview.title).toBe("Understanding Edge Computing");
    expect(preview.siteName).toBe("Example Blog");
    expect(preview.byline).toBe("Jane Doe");
    expect(preview.blocks).toEqual([
      {
        type: "paragraph",
        text: "Edge computing moves computation closer to users, cutting round trips and keeping data regional.",
      },
      { type: "heading", text: "Why it matters" },
      {
        type: "paragraph",
        text: "Latency and locality are the main reasons teams care about edge runtimes today.",
      },
      { type: "list", text: "Lower latency" },
      { type: "list", text: "Regional data handling" },
      {
        type: "quote",
        text: "Edge is a deployment strategy, not an architecture.",
      },
      { type: "code", text: "const edge = true;" },
    ]);
  });

  it("falls back to the meta description when no readable body exists", () => {
    const preview = extractArticlePreview(
      `<html><head>
        <meta property="og:title" content="A Paper Title" />
        <meta name="description" content="Short abstract of the paper." />
      </head><body><div>tiny</div></body></html>`,
      "https://example.com/paper",
    );

    expect(preview.title).toBe("A Paper Title");
    expect(preview.blocks).toEqual([
      { type: "paragraph", text: "Short abstract of the paper." },
    ]);
  });

  it("prefers a substantial article over a noisier parent container", () => {
    const html = `<html><body><main>
      <div><p>${"Navigation noise. ".repeat(30)}</p></div>
      <article>
        <h1>Story</h1>
        <p>${"Real article sentence. ".repeat(20)}</p>
      </article>
      <div><p>${"More sidebar noise. ".repeat(30)}</p></div>
    </main></body></html>`;

    const preview = extractArticlePreview(html, "https://example.com/story");

    expect(preview.blocks).toHaveLength(1);
    expect(preview.blocks[0]!.text).toContain("Real article sentence.");
  });

  it("uses the hostname when no title metadata exists", () => {
    const preview = extractArticlePreview(
      "<html><body><p>Just enough readable text to be accepted as a paragraph.</p></body></html>",
      "https://www.example.com/post",
    );

    expect(preview.title).toBe("");
    expect(preview.siteName).toBe("example.com");
  });
});

function htmlResponse(html: string, init: ResponseInit = {}): Response {
  return new Response(html, {
    ...init,
    headers: { "content-type": "text/html; charset=utf-8", ...init.headers },
  });
}

describe("fetchArticlePreview", () => {
  it("fetches and extracts an HTML article", async () => {
    const preview = await fetchArticlePreview("https://example.com/edge", {
      userAgent: "feedreader-test",
      fetchImpl: async () => htmlResponse(ARTICLE_HTML),
    });

    expect(preview.title).toBe("Understanding Edge Computing");
    expect(preview.blocks.length).toBeGreaterThan(0);
  });

  it("rejects non-HTML responses", async () => {
    await expect(
      fetchArticlePreview("https://example.com/file.pdf", {
        userAgent: "feedreader-test",
        fetchImpl: async () =>
          new Response("%PDF-1.7", {
            headers: { "content-type": "application/pdf" },
          }),
      }),
    ).rejects.toBeInstanceOf(PreviewUnavailableError);
  });

  it("rejects redirects that land on a private host", async () => {
    const response = htmlResponse(ARTICLE_HTML);
    Object.defineProperty(response, "url", {
      value: "http://127.0.0.1/internal",
    });

    await expect(
      fetchArticlePreview("https://example.com/redirect", {
        userAgent: "feedreader-test",
        fetchImpl: async () => response,
      }),
    ).rejects.toBeInstanceOf(PreviewUnavailableError);
  });

  it("follows a redirect to another public URL", async () => {
    const calls: string[] = [];
    const preview = await fetchArticlePreview("https://example.com/start", {
      userAgent: "feedreader-test",
      fetchImpl: async (input) => {
        calls.push(input);
        if (input === "https://example.com/start") {
          return new Response(null, {
            status: 301,
            headers: { location: "/moved" },
          });
        }
        return htmlResponse(ARTICLE_HTML);
      },
    });

    expect(calls).toEqual([
      "https://example.com/start",
      "https://example.com/moved",
    ]);
    expect(preview.title).toBe("Understanding Edge Computing");
  });

  it("rejects a redirect to a private host before following it", async () => {
    const calls: string[] = [];

    await expect(
      fetchArticlePreview("https://example.com/redirect", {
        userAgent: "feedreader-test",
        fetchImpl: async (input) => {
          calls.push(input);
          return new Response(null, {
            status: 302,
            headers: { location: "http://127.0.0.1/internal" },
          });
        },
      }),
    ).rejects.toBeInstanceOf(PreviewUnavailableError);

    expect(calls).toEqual(["https://example.com/redirect"]);
  });

  it("rejects redirect chains that exceed the limit", async () => {
    await expect(
      fetchArticlePreview("https://example.com/loop", {
        userAgent: "feedreader-test",
        fetchImpl: async () =>
          new Response(null, {
            status: 302,
            headers: { location: "/loop" },
          }),
      }),
    ).rejects.toBeInstanceOf(PreviewUnavailableError);
  });

  it("caps how much of the response body it reads", async () => {
    const marker = "UNIQUE_TRAILING_MARKER";
    const html = `<html><body><p>${"a".repeat(400)}</p><p>${marker}</p></body></html>`;

    const preview = await fetchArticlePreview("https://example.com/long", {
      userAgent: "feedreader-test",
      maxBytes: 260,
      fetchImpl: async () => htmlResponse(html),
    });

    expect(preview.blocks.map((block) => block.text).join(" ")).not.toContain(
      marker,
    );
  });
});
