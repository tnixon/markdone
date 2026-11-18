import type { App } from 'obsidian';
import { classifyMarker, type MarkerStatus } from '@markdone/core';

// The gate for everything this plugin does to a note in the editor/Reading
// view (spec: "The Markdone Marker"): only a note whose frontmatter carries a
// supported `markdone:` marker is a Markdone file. Read through the metadata
// cache, so it costs no file read per rendered section.
export function noteMarkerStatus(app: App, path: string): MarkerStatus {
  const frontmatter = app.metadataCache.getCache(path)?.frontmatter as Record<string, unknown> | undefined;
  return classifyMarker(frontmatter?.markdone);
}

export function isMarkdoneNote(app: App, path: string): boolean {
  return noteMarkerStatus(app, path) === 'supported';
}
