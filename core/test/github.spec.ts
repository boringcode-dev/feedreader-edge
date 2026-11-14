// Mirrors internal/sources/github_test.go's fixture and assertions.
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  gitHubTrendingSource,
  parseGitHubTrending,
} from "../sources/github.ts";

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("parseGitHubTrending", () => {
  it("normalizes the repo path from the href", () => {
    const payload = `
    <article class="Box-row">
      <h2>
        <a href="/palmier-io/palmier-pro">
          palmier-io/
          palmier-pro
        </a>
      </h2>
      <p>macOS video editor built for AI</p>
      <span itemprop="programmingLanguage">Swift</span>
      <a href="/palmier-io/palmier-pro/stargazers">2,142</a>
      <a href="/palmier-io/palmier-pro/forks">207</a>
      <span>756 stars today</span>
    </article>`;

    const items = parseGitHubTrending(payload);
    expect(items).toHaveLength(1);

    const item = items[0]!;
    expect(item.externalId).toBe("palmier-io/palmier-pro");
    expect(item.title).toBe("palmier-io/palmier-pro");
    expect(item.url).toBe("https://github.com/palmier-io/palmier-pro");
    expect(item.summary).toBe("macOS video editor built for AI");
    expect(item.metadata.language).toBe("Swift");
    expect(item.metadata.total_stars).toBe(2142);
    expect(item.metadata.forks).toBe(207);
    expect(item.metadata.stars_today).toBe(756);
    expect(item.score).toBe(756);
    expect(item.sourceRank).toBe(1);
  });
});

describe("gitHubTrendingSource", () => {
  it("reports a concise message when GitHub rate-limits the source", async () => {
    vi.useFakeTimers();
    let calls = 0;
    vi.stubGlobal("fetch", async () => {
      calls += 1;
      return new Response(
        JSON.stringify({
          code: "429",
          message: "Access to this site has been restricted.",
        }),
        {
          status: 429,
          headers: { "content-type": "application/json" },
        },
      );
    });

    const promise = gitHubTrendingSource.fetch().catch((error) => error);
    await vi.runAllTimersAsync();
    const error = await promise;

    expect(calls).toBe(3);
    expect(error).toBeInstanceOf(Error);
    if (!(error instanceof Error)) {
      throw new Error("expected an error");
    }
    expect(error.message).toContain("temporarily rate-limiting");
    expect(error.message).toContain("cached items");
    expect(error.message).not.toContain("Access to this site");
  });
});
