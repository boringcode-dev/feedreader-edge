import { describe, expect, it } from "vitest";
import {
  isElement,
  parentElement,
  parseHtmlDocument,
} from "../sources/dom.ts";

describe("parseHtmlDocument", () => {
  it("exposes body, selectors, and parent traversal", () => {
    const document = parseHtmlDocument(
      `<html><body><main><p class="x">hi</p></main></body></html>`,
    );
    expect(document.body?.tagName).toBe("BODY");

    const paragraph = document.querySelector("p.x");
    expect(paragraph?.textContent).toBe("hi");
    expect(isElement(paragraph!)).toBe(true);
    expect(parentElement(paragraph)?.tagName).toBe("MAIN");
    expect(document.querySelectorAll("p")).toHaveLength(1);
  });

  it("handles fragments without a body element", () => {
    const document = parseHtmlDocument(`<p>fragment</p>`);
    expect(document.body).toBeNull();
    expect(document.querySelector("p")?.textContent).toBe("fragment");
    expect(parentElement(document.querySelector("p"))).toBeNull();
  });
});
