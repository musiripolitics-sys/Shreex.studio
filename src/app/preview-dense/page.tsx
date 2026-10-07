import { PageHead, StatStrip, Stat, Queue, Row, ProductList, ProductRow, Split } from "@/components/os/dense";

/**
 * A fixture rendering of the new dashboard, with no database and no sign-in.
 *
 * It exists so the design can be LOOKED AT while it is being built. Reviewing a
 * signed-in page by reading its source is how you end up shipping something
 * that reads well and looks wrong. Deleted once the real dashboard is wired.
 */
export const metadata = { title: "Preview · Shreex", robots: { index: false } };

export default function PreviewDense() {
  return (
    <main id="main" className="min-h-dvh bg-ink">
      {/* Stand-in for OsShell chrome, so spacing is judged in context. */}
      <div className="flex min-h-dvh">
        <aside className="hidden w-[208px] shrink-0 border-r border-line bg-surface lg:block">
          <div className="flex h-12 items-center gap-2 border-b border-line px-3">
            <span className="grid h-6 w-6 place-items-center rounded bg-brand text-[10px] font-bold text-white">S</span>
            <span className="font-display text-[13px] font-semibold text-fg">Shreex</span>
          </div>
          <nav className="p-2 text-[13px]">
            <p className="px-2 pb-1 pt-2 text-[10px] font-semibold uppercase tracking-[0.1em] text-faint">Today</p>
            {["Dashboard", "Alerts", "Approvals"].map((l, i) => (
              <span key={l} className={`block rounded px-2 py-1 ${i === 0 ? "bg-surface-2 font-medium text-fg" : "text-muted"}`}>{l}</span>
            ))}
            <p className="px-2 pb-1 pt-3 text-[10px] font-semibold uppercase tracking-[0.1em] text-faint">Products</p>
            {["Plan", "Events", "Money", "Grow", "Marketing", "Team", "Product", "Govern", "Insights"].map((l) => (
              <span key={l} className="block rounded px-2 py-1 text-muted">{l}</span>
            ))}
          </nav>
        </aside>

        <div className="min-w-0 flex-1">
          <header className="flex h-12 items-center justify-between gap-3 border-b border-line bg-surface px-4">
            <span className="text-[13px] font-medium text-fg">Techxfluence</span>
            <div className="flex items-center gap-2 text-[12px] text-faint">
              <span className="rounded border border-line px-2 py-0.5">Search <kbd className="font-sans">⌘K</kbd></span>
              <span>admin@techxfluence.com</span>
            </div>
          </header>

          <div className="px-4 py-4 md:px-6">
            <PageHead
              title="Today"
              context="Techxfluence · Wednesday 8 October"
              actions={
                <>
                  <span className="rounded border border-line px-2 py-1 text-[12px] text-muted">This week</span>
                  <span className="rounded bg-brand px-2.5 py-1 text-[12px] font-medium text-white">New task</span>
                </>
              }
            />

            <StatStrip>
              <Stat label="Overdue" value={6} tone="bad" hint="4 are yours" href="#" />
              <Stat label="Awaiting you" value={3} tone="warn" hint="2 approvals, 1 review" href="#" />
              <Stat label="Due today" value={5} href="#" />
              <Stat label="At risk" value={2} tone="warn" hint="high-impact, unmitigated" href="#" />
            </StatStrip>

            <Split
              main={
                <>
                  <Queue title="Overdue" count={6} tone="bad" href="#" empty="Nothing overdue.">
                    <Row href="#" primary="Finalise Q4 sponsor deck" secondary="Marketing" meta="12 days" tone="bad" />
                    <Row href="#" primary="Reconcile October vendor invoices" secondary="Money" meta="9 days" tone="bad" />
                    <Row href="#" primary="Close out hackathon post-event report" secondary="Events" meta="5 days" tone="bad" />
                    <Row href="#" primary="Sign off updated privacy policy" secondary="Govern" meta="3 days" tone="bad" />
                    <Row href="#" primary="Confirm venue for December meetup" secondary="Events" meta="1 day" tone="bad" />
                  </Queue>

                  <Queue title="Awaiting your approval" count={3} tone="warn" href="#">
                    <Row href="#" primary="₹48,000 — AV hire for December meetup" secondary="Priya" meta="2 days" tone="warn" />
                    <Row href="#" primary="Task completion — speaker outreach" secondary="Cal" meta="1 day" tone="warn" />
                    <Row href="#" primary="₹12,500 — printed badges" secondary="Rahul" meta="4 hours" />
                  </Queue>

                  <Queue title="Blocked" count={2} href="#">
                    <Row href="#" primary="Publish December event page" secondary="waiting on venue confirmation" />
                    <Row href="#" primary="Invoice Acme sponsorship" secondary="waiting on signed agreement" />
                  </Queue>

                  <ProductList>
                    <ProductRow href="#" name="Plan" detail="14 goals, 62 tasks" count="6 overdue" />
                    <ProductRow href="#" name="Events" detail="3 upcoming, 1 live" count="412 registered" />
                    <ProductRow href="#" name="Money" detail="₹2.4L in, ₹1.1L out this month" count="7 unpaid" />
                    <ProductRow href="#" name="Grow" detail="28 leads, 4 proposals out" count="2 stale" />
                    <ProductRow href="#" name="Marketing" detail="2 campaigns running" count="9 posts queued" />
                    <ProductRow href="#" name="Team" detail="11 people, 2 onboarding" count="—" />
                    <ProductRow href="#" name="Product" detail="18 modules in build" count="3 bugs" />
                    <ProductRow href="#" name="Govern" detail="9 risks, 14 SOPs" count="2 at risk" />
                    <ProductRow href="#" name="Insights" detail="last refreshed 10 min ago" count="—" />
                  </ProductList>
                </>
              }
              aside={
                <>
                  <Queue title="Due today" count={5} href="#">
                    <Row href="#" primary="Weekly finance sync notes" meta="09:00" />
                    <Row href="#" primary="Send speaker confirmations" meta="11:00" />
                    <Row href="#" primary="Review landing page copy" meta="14:00" />
                    <Row href="#" primary="Approve November budget" meta="16:00" />
                    <Row href="#" primary="Draft December newsletter" meta="EOD" />
                  </Queue>

                  <Queue title="Recently decided" count={3} href="#">
                    <Row href="#" primary="₹30,000 catering — approved" secondary="you" meta="1h" />
                    <Row href="#" primary="Venue change — approved" secondary="you" meta="yesterday" />
                    <Row href="#" primary="Extra AV budget — rejected" secondary="you" meta="2 days" />
                  </Queue>

                  <Queue title="Needs an owner" count={2} tone="warn" href="#">
                    <Row href="#" primary="Update sponsor deck template" secondary="Marketing" tone="warn" />
                    <Row href="#" primary="Quarterly risk review" secondary="Govern" tone="warn" />
                  </Queue>
                </>
              }
            />
          </div>
        </div>
      </div>
    </main>
  );
}
