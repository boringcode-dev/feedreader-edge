// Thin wrapper around node-html-parser — the one HTML-parsing dependency in
// this codebase, used by github.ts and the reader-view extractor. Isolated
// here so swapping parsers later only touches this file.
//
// node-html-parser exposes a small DOM-like surface (querySelector,
// querySelectorAll, closest, children, nextElementSibling, classList,
// textContent) but no `parentElement`, so that accessor is wrapped below.

import {
  parse,
  type HTMLElement,
  type Node as HtmlNode,
} from "node-html-parser";

export type HtmlElement = HTMLElement;
export type { HtmlNode };

export interface HtmlDocument {
  body: HtmlElement | null;
  querySelector(selector: string): HtmlElement | null;
  querySelectorAll(selector: string): HtmlElement[];
}

export function isElement(node: HtmlNode): node is HtmlElement {
  return node.nodeType === 1;
}

export function parseHtmlDocument(html: string): HtmlDocument {
  const root = parse(html, { comment: false });
  return {
    body: root.querySelector("body"),
    querySelector: (selector) => root.querySelector(selector),
    querySelectorAll: (selector) => root.querySelectorAll(selector),
  };
}

export function parentElement(
  element: HtmlElement | null,
): HtmlElement | null {
  const parent = element?.parentNode ?? null;
  // The parser root has a null tagName; DOM `parentElement` returns null for
  // top-level elements rather than exposing the document root.
  return parent && parent.tagName ? parent : null;
}
