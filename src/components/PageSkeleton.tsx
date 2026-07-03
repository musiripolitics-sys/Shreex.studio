/**
 * Route-level loading skeleton shown instantly while server components fetch.
 * `variant` roughly matches the destination layout so the swap feels smooth.
 */
export function PageSkeleton({
  variant = "page",
}: {
  variant?: "page" | "list" | "feed";
}) {
  return (
    <div className="mx-auto max-w-4xl animate-pulse px-5 py-12 sm:px-8">
      <div className="h-3 w-24 rounded-full bg-ink-2" />
      <div className="mt-4 h-8 w-64 rounded-lg bg-ink-2" />
      <div className="mt-3 h-4 w-96 max-w-full rounded bg-ink-2" />

      {variant === "list" && (
        <div className="mt-10 space-y-4">
          {[0, 1, 2].map((i) => (
            <div key={i} className="flex gap-4 rounded-2xl border border-line bg-surface p-4">
              <div className="h-24 w-40 shrink-0 rounded-xl bg-ink-2" />
              <div className="flex-1 space-y-3 py-2">
                <div className="h-4 w-1/2 rounded bg-ink-2" />
                <div className="h-3 w-2/3 rounded bg-ink-2" />
                <div className="h-3 w-1/3 rounded bg-ink-2" />
              </div>
            </div>
          ))}
        </div>
      )}

      {variant === "feed" && (
        <div className="mt-10 space-y-4">
          <div className="h-28 rounded-2xl border border-line bg-surface" />
          {[0, 1].map((i) => (
            <div key={i} className="rounded-2xl border border-line bg-surface p-5">
              <div className="flex items-center gap-3">
                <div className="h-10 w-10 rounded-full bg-ink-2" />
                <div className="space-y-2">
                  <div className="h-3 w-32 rounded bg-ink-2" />
                  <div className="h-2 w-16 rounded bg-ink-2" />
                </div>
              </div>
              <div className="mt-4 h-3 w-3/4 rounded bg-ink-2" />
            </div>
          ))}
        </div>
      )}

      {variant === "page" && (
        <div className="mt-10 grid gap-4 sm:grid-cols-2">
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="h-36 rounded-2xl border border-line bg-surface" />
          ))}
        </div>
      )}
    </div>
  );
}
