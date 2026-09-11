// Shared loading skeleton for every dashboard segment. Rendered by each
// route's loading.tsx so the shell stays put and this paints instantly on
// navigation, while the (force-dynamic, DB-backed) page streams in behind it.
//
// One loading.tsx per segment is deliberate: a single shared parent loading.tsx
// only fires on first entry into /app — React keeps the old page visible during
// a sibling transition and never re-shows a parent boundary's fallback. A
// boundary at each segment gives every nav click its own fresh skeleton.
export function PageSkeleton() {
  return (
    <section className="stage" aria-busy="true">
      <div className="page">
        <div className="sk sk-h1" />
        <div className="sk sk-lead" />
        <div className="sk-list">
          <div className="sk sk-row" />
          <div className="sk sk-row" />
          <div className="sk sk-row" />
          <div className="sk sk-row" />
        </div>
        <span className="sk-sr">Loading…</span>
      </div>
    </section>
  );
}
