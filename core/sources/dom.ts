// Thin wrapper around linkedom — the one DOM-parsing dependency in this
// codebase, used only by github.ts and alphaxiv.ts (the two sources whose
// extraction logic is structurally DOM-relationship-dependent, ported from
// goquery in the Go app). Isolated here so swapping parsers later only
// touches this file.

import { parseHTML } from "linkedom";

export function parseHtmlDocument(html: string): Document {
  return parseHTML(html).document as unknown as Document;
}
