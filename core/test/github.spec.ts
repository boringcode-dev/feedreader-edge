// Mirrors internal/sources/github_test.go's fixture and assertions.
import { describe, expect, it } from "vitest";
import { parseGitHubTrending } from "../sources/github.ts";

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
