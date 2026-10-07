"use client";

import { useMemo, useState, useTransition } from "react";
import { toast } from "@/components/Toast";
import { Card, KpiCard, EmptyState } from "@/components/os/ui";
import { Modal, Field, Input, Select, FormActions } from "@/components/os/Modal";
import { num, shortDate, rupeesToPaise, paiseToRupees } from "@/lib/bos";
import { saveEpisode, setEpisodeStage } from "@/lib/marketing-actions";

export type Episode = {
  id: string; number: number | null; title: string; guest: string | null;
  topic: string | null; recording_date: string | null;
  editing_status: string; publishing_status: string; youtube_status: string;
  shorts_target: number; shorts_published: number;
  views: number; engagement: number; leads: number; conversions: number;
  budget: number; actual_cost: number;
};

// An episode is a relay: recorded, then cut, then published, then clipped.
// Each stage has to finish before the next can start, which is why they are
// shown in order rather than as independent fields.
const STAGES = [
  { key: "editing_status", label: "Edit" },
  { key: "publishing_status", label: "Publish" },
  { key: "youtube_status", label: "YouTube" },
] as const;

const STATES = ["not_started", "in_progress", "completed", "blocked"];

const DOT: Record<string, string> = {
  not_started: "bg-surface-2 border-line",
  in_progress: "bg-blue-500 border-blue-500",
  completed: "bg-green-500 border-green-500",
  blocked: "bg-red-500 border-red-500",
};

/**
 * The podcast, as a production line.
 *
 * An episode is not done when it is recorded; it is done when the clips are
 * out. Showing the three stages side by side makes the one that is actually
 * holding everything up visible, which a status column cannot do.
 */
export function PodcastClient({ episodes }: { episodes: Episode[] }) {
  const [editing, setEditing] = useState<Episode | null>(null);
  const [creating, setCreating] = useState(false);
  const [saving, start] = useTransition();

  const stats = useMemo(() => {
    const live = episodes.filter((e) => e.youtube_status !== "completed");
    return {
      total: episodes.length,
      inFlight: live.length,
      views: episodes.reduce((a, e) => a + (e.views ?? 0), 0),
      shorts: episodes.reduce((a, e) => a + (e.shorts_published ?? 0), 0),
      shortsTarget: episodes.reduce((a, e) => a + (e.shorts_target ?? 0), 0),
    };
  }, [episodes]);

  const advance = (ep: Episode, field: string, value: string) =>
    start(async () => {
      const res = await setEpisodeStage(ep.id, field, value);
      if ("error" in res && res.error) toast(res.error, "error");
      else toast("Updated", "success");
    });

  return (
    <>
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="font-display text-2xl font-bold tracking-tight text-fg">Podcast</h1>
          <p className="max-w-3xl text-sm text-muted">
            Every episode and where it has got to. Recording is the start of the work, not the end.
          </p>
        </div>
        <button onClick={() => setCreating(true)} className="shrink-0 rounded-full bg-brand px-4 py-2 text-sm font-medium text-white">
          + New episode
        </button>
      </div>

      <div className="mb-5 grid grid-cols-2 gap-3 md:grid-cols-4">
        <KpiCard label="Episodes" value={String(stats.total)} />
        <KpiCard label="Still in production" value={String(stats.inFlight)} tone={stats.inFlight ? "warn" : "good"} />
        <KpiCard label="Views" value={num(stats.views)} />
        <KpiCard label="Shorts out"
          value={stats.shortsTarget ? `${stats.shorts} / ${stats.shortsTarget}` : String(stats.shorts)} />
      </div>

      {episodes.length === 0 ? (
        <EmptyState title="No episodes yet" hint="Add the first one and track it from recording to clips." />
      ) : (
        <div className="space-y-2">
          {episodes.map((e) => (
            <Card key={e.id} className="!p-0">
              <div className="flex flex-wrap items-start gap-4 p-4">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    {e.number != null && (
                      <span className="rounded-full bg-surface-2 px-2 py-0.5 font-mono text-[11px] text-muted">
                        #{e.number}
                      </span>
                    )}
                    <button onClick={() => setEditing(e)} className="font-medium text-fg hover:text-brand hover:underline">
                      {e.title}
                    </button>
                  </div>
                  <p className="mt-0.5 text-xs text-muted">
                    {e.guest ? `with ${e.guest}` : "No guest"}
                    {e.topic ? ` · ${e.topic}` : ""}
                  </p>
                  <p className="mt-0.5 text-[11px] text-faint">
                    {e.recording_date ? `Recorded ${shortDate(e.recording_date)}` : "Not recorded yet"}
                    {e.views > 0 ? ` · ${num(e.views)} views` : ""}
                    {e.shorts_target > 0 ? ` · ${e.shorts_published}/${e.shorts_target} shorts` : ""}
                  </p>
                </div>

                {/* ── The production line ── */}
                <div className="flex shrink-0 items-center gap-1">
                  {STAGES.map((s, i) => {
                    const value = e[s.key];
                    return (
                      <div key={s.key} className="flex items-center">
                        <div className="text-center">
                          <span className="mb-1 block text-[10px] uppercase tracking-wider text-faint">{s.label}</span>
                          <Select
                            value={value}
                            disabled={saving}
                            onChange={(ev) => advance(e, s.key, ev.target.value)}
                            className="!w-[7.5rem] !py-1 !text-xs"
                          >
                            {STATES.map((st) => <option key={st} value={st}>{st.replace("_", " ")}</option>)}
                          </Select>
                        </div>
                        {i < STAGES.length - 1 && (
                          <span className={`mx-1 mt-4 h-2 w-2 shrink-0 rounded-full border ${DOT[value] ?? ""}`} />
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            </Card>
          ))}
        </div>
      )}

      <EpisodeForm open={creating || !!editing} episode={editing}
        onClose={() => { setCreating(false); setEditing(null); }} />
    </>
  );
}

function EpisodeForm({ open, episode, onClose }: { open: boolean; episode: Episode | null; onClose: () => void }) {
  const [saving, start] = useTransition();
  const [form, setForm] = useState(() => ({
    number: episode?.number != null ? String(episode.number) : "",
    title: episode?.title ?? "", guest: episode?.guest ?? "", topic: episode?.topic ?? "",
    recording_date: episode?.recording_date?.slice(0, 10) ?? "",
    editing_status: episode?.editing_status ?? "not_started",
    publishing_status: episode?.publishing_status ?? "not_started",
    youtube_status: episode?.youtube_status ?? "not_started",
    shorts_target: String(episode?.shorts_target ?? ""), shorts_published: String(episode?.shorts_published ?? ""),
    views: String(episode?.views ?? ""), leads: String(episode?.leads ?? ""),
    budgetR: episode?.budget ? String(paiseToRupees(episode.budget)) : "",
    costR: episode?.actual_cost ? String(paiseToRupees(episode.actual_cost)) : "",
  }));
  const set = (k: keyof typeof form, v: string) => setForm((f) => ({ ...f, [k]: v }));

  return (
    <Modal open={open} onClose={onClose} title={episode ? "Edit episode" : "New episode"} wide>
      <form onSubmit={(e) => {
        e.preventDefault();
        start(async () => {
          const res = await saveEpisode(episode?.id ?? null, {
            ...form,
            number: form.number === "" ? null : form.number,
            shorts_target: form.shorts_target || 0, shorts_published: form.shorts_published || 0,
            views: form.views || 0, leads: form.leads || 0,
            budget: rupeesToPaise(Number(form.budgetR) || 0),
            actual_cost: rupeesToPaise(Number(form.costR) || 0),
          });
          if ("error" in res && res.error) toast(res.error, "error");
          else { toast("Saved", "success"); onClose(); }
        });
      }}>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Number"><Input type="number" min={0} value={form.number} onChange={(e) => set("number", e.target.value)} /></Field>
          <Field label="Recorded on"><Input type="date" value={form.recording_date} onChange={(e) => set("recording_date", e.target.value)} /></Field>
          <div className="sm:col-span-2">
            <Field label="Title"><Input value={form.title} onChange={(e) => set("title", e.target.value)} required /></Field>
          </div>
          <Field label="Guest"><Input value={form.guest} onChange={(e) => set("guest", e.target.value)} /></Field>
          <Field label="Topic"><Input value={form.topic} onChange={(e) => set("topic", e.target.value)} /></Field>
          {STAGES.map((s) => (
            <Field key={s.key} label={s.label}>
              <Select value={form[s.key]} onChange={(e) => set(s.key, e.target.value)}>
                {STATES.map((st) => <option key={st} value={st}>{st.replace("_", " ")}</option>)}
              </Select>
            </Field>
          ))}
          <Field label="Shorts planned"><Input type="number" min={0} value={form.shorts_target} onChange={(e) => set("shorts_target", e.target.value)} /></Field>
          <Field label="Shorts out"><Input type="number" min={0} value={form.shorts_published} onChange={(e) => set("shorts_published", e.target.value)} /></Field>
          <Field label="Views"><Input type="number" min={0} value={form.views} onChange={(e) => set("views", e.target.value)} /></Field>
          <Field label="Leads"><Input type="number" min={0} value={form.leads} onChange={(e) => set("leads", e.target.value)} /></Field>
          <Field label="Budget (₹)"><Input type="number" min={0} value={form.budgetR} onChange={(e) => set("budgetR", e.target.value)} /></Field>
          <Field label="Actual cost (₹)"><Input type="number" min={0} value={form.costR} onChange={(e) => set("costR", e.target.value)} /></Field>
        </div>
        <FormActions onCancel={onClose} saving={saving} submitLabel="Save" />
      </form>
    </Modal>
  );
}
