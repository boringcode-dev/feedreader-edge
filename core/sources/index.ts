// Port of internal/sources/sources.go.

import type { FeedItem } from "../domain.ts";
import { gitHubTrendingSource } from "./github.ts";
import { hackerNewsSource } from "./hackernews.ts";
import { huggingFacePapersSource } from "./huggingface.ts";

export interface Source {
  key(): string;
  label(): string;
  homepageUrl(): string;
  fetch(): Promise<FeedItem[]>;
}

export function build(): Source[] {
  return [hackerNewsSource, gitHubTrendingSource, huggingFacePapersSource];
}
