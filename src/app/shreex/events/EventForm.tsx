"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "@/components/Toast";
import { Modal, Field, Input, Textarea, Select, FormActions } from "@/components/os/Modal";
import { rupeesToPaise, paiseToRupees } from "@/lib/bos";
import { saveEvent } from "./actions";

const CATEGORIES = ["Meetup", "Workshop", "Webinar", "Hackathon", "Conference", "Networking", "Product Launch"] as const;
const STATUSES = ["draft", "pending_review", "approved", "published", "cancelled", "completed"] as const;

export type EditableEvent = {
  id: string; title: string; category: string;
  date: string; end_date: string | null; time: string | null;
  city: string; venue: string | null; address: string | null;
  price_type: string; price_amount: number; price_label: string | null;
  capacity: number; blurb: string | null; about: string | null;
  image_url: string | null; status: string;
  host_id: string | null; host_name: string | null;
};

const blank = {
  title: "", category: "Meetup", date: "", end_date: "", time: "",
  city: "", venue: "", address: "",
  price_type: "Free", priceRupees: "", price_label: "",
  capacity: "", blurb: "", about: "", image_url: "",
  status: "draft", host_id: "", host_name: "",
};

/**
 * The event as the website renders it.
 *
 * Every field here is a field on the public page, which is the point: the OS
 * is where an event is written, and /events is the view of it. The ops
 * overlay — budget, owner, campaign — is edited separately on the list, since
 * none of it is public.
 */
export function EventForm({
  open,
  onClose,
  event,
  owners,
}: {
  open: boolean;
  onClose: () => void;
  event: EditableEvent | null;
  owners: { id: string; full_name: string | null; email: string | null }[];
}) {
  const router = useRouter();
  const [saving, start] = useTransition();
  const [form, setForm] = useState(() =>
    event
      ? {
          title: event.title, category: event.category,
          date: event.date?.slice(0, 10) ?? "", end_date: event.end_date?.slice(0, 10) ?? "",
          time: event.time ?? "", city: event.city ?? "", venue: event.venue ?? "",
          address: event.address ?? "", price_type: event.price_type ?? "Free",
          priceRupees: event.price_amount ? String(paiseToRupees(event.price_amount)) : "",
          price_label: event.price_label ?? "", capacity: event.capacity ? String(event.capacity) : "",
          blurb: event.blurb ?? "", about: event.about ?? "", image_url: event.image_url ?? "",
          status: event.status, host_id: event.host_id ?? "", host_name: event.host_name ?? "",
        }
      : { ...blank },
  );

  const set = (k: keyof typeof form, v: string) => setForm((f) => ({ ...f, [k]: v }));
  const paid = form.price_type === "Paid";

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    start(async () => {
      const res = await saveEvent(event?.id ?? null, {
        ...form,
        price_amount: paid ? rupeesToPaise(Number(form.priceRupees) || 0) : 0,
        capacity: form.capacity || 0,
        end_date: form.end_date || null,
      });
      if ("error" in res && res.error) toast(res.error, "error");
      else {
        toast(event ? "Event updated" : "Event created", "success");
        onClose();
        router.refresh();
      }
    });
  };

  return (
    <Modal open={open} onClose={onClose} title={event ? "Edit event" : "New event"} wide>
      <form onSubmit={submit}>
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="sm:col-span-2">
            <Field label="Title">
              <Input value={form.title} onChange={(e) => set("title", e.target.value)} required />
            </Field>
          </div>

          <Field label="Category">
            <Select value={form.category} onChange={(e) => set("category", e.target.value)}>
              {CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
            </Select>
          </Field>
          <Field label="Status">
            <Select value={form.status} onChange={(e) => set("status", e.target.value)}>
              {STATUSES.map((s) => (
                <option key={s} value={s}>{s.replace("_", " ")}</option>
              ))}
            </Select>
          </Field>

          <Field label="Date">
            <Input type="date" value={form.date} onChange={(e) => set("date", e.target.value)} required />
          </Field>
          <Field label="Ends (for multi-day)">
            <Input type="date" value={form.end_date} onChange={(e) => set("end_date", e.target.value)} />
          </Field>

          <Field label="Time">
            <Input value={form.time} onChange={(e) => set("time", e.target.value)} placeholder="6:30 PM – 9:00 PM" />
          </Field>
          <Field label="City">
            <Input value={form.city} onChange={(e) => set("city", e.target.value)} required />
          </Field>

          <Field label="Venue">
            <Input value={form.venue} onChange={(e) => set("venue", e.target.value)} placeholder="IITM Research Park" />
          </Field>
          <Field label="Capacity">
            <Input
              type="number"
              min={0}
              value={form.capacity}
              onChange={(e) => set("capacity", e.target.value)}
              placeholder="0 = unlimited"
            />
          </Field>

          <div className="sm:col-span-2">
            <Field label="Address">
              <Input value={form.address} onChange={(e) => set("address", e.target.value)} />
            </Field>
          </div>

          <Field label="Price">
            <Select value={form.price_type} onChange={(e) => set("price_type", e.target.value)}>
              <option value="Free">Free</option>
              <option value="Paid">Paid</option>
            </Select>
          </Field>
          <Field label={paid ? "Amount (₹)" : "Amount — free events have none"}>
            <Input
              type="number"
              min={0}
              disabled={!paid}
              value={paid ? form.priceRupees : ""}
              onChange={(e) => set("priceRupees", e.target.value)}
            />
          </Field>

          <Field label="Host name (shown on the page)">
            <Input value={form.host_name} onChange={(e) => set("host_name", e.target.value)} />
          </Field>
          <Field label="Host account">
            <Select value={form.host_id} onChange={(e) => set("host_id", e.target.value)}>
              <option value="">Nobody</option>
              {owners.map((o) => (
                <option key={o.id} value={o.id}>{o.full_name || o.email}</option>
              ))}
            </Select>
          </Field>

          <div className="sm:col-span-2">
            <Field label="Image URL">
              <Input value={form.image_url} onChange={(e) => set("image_url", e.target.value)} placeholder="/events/meetup.jpg" />
            </Field>
          </div>
          <div className="sm:col-span-2">
            <Field label="Blurb — the one line on the card">
              <Textarea rows={2} value={form.blurb} onChange={(e) => set("blurb", e.target.value)} />
            </Field>
          </div>
          <div className="sm:col-span-2">
            <Field label="About — the full description on the page">
              <Textarea rows={5} value={form.about} onChange={(e) => set("about", e.target.value)} />
            </Field>
          </div>
        </div>

        <p className="mt-3 text-xs text-faint">
          The web address is generated from the title and kept unique. Publishing makes
          this visible on the public site straight away.
        </p>

        <FormActions onCancel={onClose} saving={saving} submitLabel={event ? "Save event" : "Create event"} />
      </form>
    </Modal>
  );
}
