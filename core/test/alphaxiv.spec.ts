// Ports internal/sources/alphaxiv_test.go's three cases against the exact
// same fixture HTML, since alphaXiv's parent-walk DOM probe is the
// highest-risk piece of this port to get subtly wrong.
import { describe, expect, it } from "vitest";
import { parseAlphaXivExplore } from "../sources/alphaxiv.ts";

const CARD_FIXTURE = `
<div class="rounded-xl border-[0.5px] border-border bg-bg px-4 py-3 backdrop-blur-sm transition-all hover:shadow-md">
  <div class="flex w-full gap-6">
    <div class="flex min-w-0 flex-1 flex-col gap-4">
      <a data-loading-trigger="true" href="/abs/2606.15956" target="_self">
        <div class="box-border grid w-full overflow-hidden text-left wrap-break-word whitespace-normal">
          <div class="tiptap html-renderer box-border w-full overflow-hidden text-left wrap-break-word whitespace-normal text-[22px] leading-tight font-bold text-text transition-all hover:underline">You Don't Need Strong Assumptions: Visual Representation Learning via Temporal Differences</div>
        </div>
      </a>
      <div class="flex items-center gap-4">
        <span class="text-sm font-medium whitespace-nowrap text-text">14 Jun 2026</span>
        <div class="relative min-w-0 overflow-hidden">
          <div class="scrollbar-hide flex items-center gap-4 overflow-x-auto mask-fade-x mask-fade-x-start-0 mask-fade-x-end-0">
            <div class="flex shrink-0 items-center gap-3 text-sm">
              <div class="flex items-center gap-1.5 font-normal">Ninad Daithankar</div>
              <div class="flex items-center gap-1.5 font-normal">Alexi Gladstone</div>
              <div class="flex items-center gap-1.5 font-normal">Yann LeCun</div>
            </div>
          </div>
        </div>
      </div>
      <div class="flex flex-col gap-1">
        <p class="line-clamp-4 text-xs/normal font-normal tracking-wide text-subtext">
          <svg class="lucide lucide-sparkles"></svg>
          <span>Researchers from UIUC and NYU propose Temporal Difference in Vision (TDV), a self-supervised method for learning visual representations from video by predicting future frame embeddings from past frames and learned motion.</span>
        </p>
        <a href="/overview/2606.15956" class="inline-flex items-center text-xs font-semibold text-blue hover:underline">View blog</a>
      </div>
      <div class="flex items-center justify-between">
        <div class="scrollbar-hide flex items-center gap-4 overflow-x-auto mask-fade-x mask-fade-x-start-0 mask-fade-x-end-0">
          <a data-loading-trigger="true" href="/?subcategories=%5B%22artificial-intelligence%22%5D" class="shrink-0 cursor-pointer text-xs font-medium text-text transition-colors hover:text-custom-red">#artificial-intelligence</a>
          <a data-loading-trigger="true" href="/?subcategories=%5B%22computer-vision-and-pattern-recognition%22%5D" class="shrink-0 cursor-pointer text-xs font-medium text-text transition-colors hover:text-custom-red">#computer-vision-and-pattern-recognition</a>
          <a data-loading-trigger="true" href="/?subcategories=%5B%22machine-learning%22%5D" class="shrink-0 cursor-pointer text-xs font-medium text-text transition-colors hover:text-custom-red">#machine-learning</a>
        </div>
      </div>
      <div class="mt-auto flex items-center justify-between gap-2">
        <div class="scrollbar-hide flex min-w-0 flex-1 items-center gap-4 overflow-x-auto mask-fade-x mask-fade-x-start-0 mask-fade-x-end-0">
          <button class="cursor-pointer items-center gap-1.5 text-sm transition-colors flex h-8 shrink-0 rounded-full px-2.5 py-1.5 font-normal bg-surface text-text">
            <div class="interactable-overlay bg-overlay"></div>
            <svg class="lucide lucide-thumbs-up" aria-hidden="true"></svg>
            <span class="inline-block">86</span>
          </button>
          <a data-loading-trigger="true" href="/replicate/2606.15956" target="_self" class="flex h-8 shrink-0 items-center gap-1.5 rounded-full bg-surface px-2.5 py-1.5 text-sm font-normal text-text transition-colors"><span>Run now</span></a>
          <a data-loading-trigger="true" href="/audio/2606.15956" target="_self" class="flex h-8 shrink-0 items-center gap-1.5 rounded-full bg-surface px-2.5 py-1.5 text-sm font-normal text-text transition-colors"><span>Audio</span></a>
        </div>
      </div>
    </div>
  </div>
</div>`;

describe("parseAlphaXivExplore", () => {
  it("extracts paper fields from a card", () => {
    const items = parseAlphaXivExplore(CARD_FIXTURE);
    expect(items).toHaveLength(1);

    const item = items[0]!;
    expect(item.source).toBe("alphaxiv");
    expect(item.externalId).toBe("2606.15956");
    expect(item.url).toBe("https://www.alphaxiv.org/abs/2606.15956");
    expect(item.title).toBe(
      "You Don't Need Strong Assumptions: Visual Representation Learning via Temporal Differences",
    );
    expect(item.summary).toContain("Temporal Difference in Vision");
    expect(item.author).toBe("Ninad Daithankar, Alexi Gladstone, Yann LeCun");
    expect(item.score).toBe(86);
    expect(item.publishedAt).toBe(
      new Date(Date.UTC(2026, 5, 14)).toISOString(),
    );
    expect(item.sourceRank).toBe(1);
    expect(item.metadata.tags).toEqual([
      "artificial-intelligence",
      "computer-vision-and-pattern-recognition",
      "machine-learning",
    ]);
  });

  it("skips cards without an /abs/ link", () => {
    const payload = `
    <div>
      <a href="/overview/2606.15956">View blog</a>
      <div>Not a paper card</div>
    </div>`;
    expect(parseAlphaXivExplore(payload)).toHaveLength(0);
  });

  it("normalizes non-breaking-space-separated dates", () => {
    const items = parseAlphaXivExplore(`
      <div>
        <a href="/abs/9999.99999">Some Paper</a>
        <div>
          <svg class="lucide-thumbs-up"></svg>
          <span>14&nbsp;Jun&nbsp;2026</span>
        </div>
      </div>`);
    expect(items).toHaveLength(1);
    expect(items[0]!.publishedAt).toBe(
      new Date(Date.UTC(2026, 5, 14)).toISOString(),
    );
  });
});
