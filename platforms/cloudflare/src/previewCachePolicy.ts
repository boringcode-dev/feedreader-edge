// Preview edge-cache policy. Empty results retry sooner so a transient
// AI/Browser Run failure does not leave the preview blank for half an hour.

export const PREVIEW_CACHE_TTL_SECONDS = 1800;
export const PREVIEW_EMPTY_CACHE_TTL_SECONDS = 300;

export function previewCacheTtlSeconds(blockCount: number): number {
  return blockCount === 0
    ? PREVIEW_EMPTY_CACHE_TTL_SECONDS
    : PREVIEW_CACHE_TTL_SECONDS;
}
