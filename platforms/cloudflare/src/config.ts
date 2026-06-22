// Port of the subset of internal/config/config.go that still applies on
// Workers. refreshIntervalHours/host/port/dbPath don't port: Cron Triggers
// replace the interval, and Workers has no host/port/dbpath concept.

import type { Env } from "./env.d.ts";

export interface Config {
  itemsPerSource: number;
  userAgent: string;
}

export function loadConfig(env: Env): Config {
  const itemsPerSource = Number.parseInt(
    env.FEEDREADER_ITEMS_PER_SOURCE ?? "",
    10,
  );
  return {
    itemsPerSource:
      Number.isFinite(itemsPerSource) && itemsPerSource > 0
        ? itemsPerSource
        : 20,
    userAgent: env.FEEDREADER_USER_AGENT?.trim() || "feedreader/0.1",
  };
}
