import { getServerEnv } from "@pulse/shared";
import type { GraphAdapter } from "./types.js";
import { MockGraphAdapter } from "./mock.js";
import { LiveGraphAdapter } from "./live.js";

let cached: GraphAdapter | null = null;

/** Returns MockGraphAdapter when GRAPH_MODE=mock (default), LiveGraphAdapter when 'live'. */
export function getGraphAdapter(): GraphAdapter {
  if (cached) return cached;
  const env = getServerEnv();
  cached = env.GRAPH_MODE === "live" ? new LiveGraphAdapter() : new MockGraphAdapter();
  return cached;
}
