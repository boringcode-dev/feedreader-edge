import { describe, expect, it } from "vitest";
import { build } from "../sources/index.ts";

describe("build", () => {
  it("registers only the supported feed sources", () => {
    expect(build().map((source) => source.key())).toEqual([
      "hackernews",
      "github",
      "huggingface",
    ]);
  });
});
