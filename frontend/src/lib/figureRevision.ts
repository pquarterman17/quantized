// A short content label for a figure document: what the Publication Preview
// shows beside Export, what the preview's refresh notice names and what an
// export's confirmation reports, so "which version did I just write?" has an
// answer. It covers everything the file depends on in the document (view,
// bindings, overlays and the output choices) and nothing else: the id and the
// name are identity, not content, so a detached draft's fresh id never reads as
// a new revision. Read-only; never persisted.

import type { FigureDocument } from "./figureDocument";
import { canonicalJson } from "./canonicalJson";

/** 8 hex digits (FNV-1a over the canonical JSON): enough to tell two
 *  revisions of one figure apart on screen, not a security digest. */
export function figureRevision(document: FigureDocument): string {
  const { id: _id, name: _name, ...content } = document;
  const text = canonicalJson(content);
  let hash = 0x811c9dc5;
  for (let index = 0; index < text.length; index++) {
    hash = Math.imul(hash ^ text.charCodeAt(index), 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}
