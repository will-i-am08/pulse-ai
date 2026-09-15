/** Format a scheduled slot like "Tue 7:00 pm" in the process timezone. */
export function formatScheduledSlot(d: Date): string {
  return new Intl.DateTimeFormat("en-AU", {
    weekday: "short",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  }).format(d);
}

/** Short weekday like "Tue" in the process timezone. */
export function formatWeekday(d: Date): string {
  return new Intl.DateTimeFormat("en-AU", { weekday: "short" }).format(d);
}

/** Local YYYY-MM-DD (en-CA) so day buckets follow the process timezone, not UTC. */
export function localYmd(d: Date): string {
  return new Intl.DateTimeFormat("en-CA", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(d);
}

/** "Tue", "Tue and Thu", "Mon, Wed, and Fri". */
export function joinEnglish(items: string[]): string {
  const parts = items.map((s) => s.trim()).filter(Boolean);
  if (parts.length === 0) return "";
  if (parts.length === 1) return parts[0]!;
  if (parts.length === 2) return `${parts[0]} and ${parts[1]}`;
  return `${parts.slice(0, -1).join(", ")}, and ${parts[parts.length - 1]}`;
}
