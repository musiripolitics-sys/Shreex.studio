"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getCurrentUser, isAdmin } from "@/lib/auth";
import { MODULES } from "@/lib/os-modules";
import { rupeesToPaise } from "@/lib/bos";

/**
 * One generic mutation for all config-driven modules. Security:
 *   • re-checks admin (RLS also enforces),
 *   • only accepts a known module key (and rejects read-only ones),
 *   • only writes columns declared in that module's field config,
 *   • coerces each value by its declared type (money → paise),
 *   • records an audit_log row and revalidates the module.
 */

async function requireAdmin() {
  const user = await getCurrentUser();
  if (!user) return { error: "Not signed in" as const };
  if (!(await isAdmin())) return { error: "Not authorised" as const };
  return { user };
}

type Raw = Record<string, unknown>;

function coerce(config: (typeof MODULES)[string], raw: Raw) {
  const row: Record<string, unknown> = {};
  for (const f of config.fields) {
    if (!(f.key in raw)) continue;
    const v = raw[f.key];
    switch (f.type) {
      case "money": {
        const n = Number(v);
        row[f.key] = Number.isFinite(n) ? rupeesToPaise(n) : 0;
        break;
      }
      case "number": {
        if (v === "" || v == null) row[f.key] = null;
        else {
          const n = Number(v);
          row[f.key] = Number.isFinite(n) ? n : null;
        }
        break;
      }
      case "checkbox":
        row[f.key] = Boolean(v);
        break;
      case "date":
      case "workstream":
      case "owner":
      case "event":
      case "goal":
      case "campaign":
        row[f.key] = v ? String(v) : null;
        break;
      default: {
        const s = typeof v === "string" ? v.trim() : v == null ? "" : String(v);
        row[f.key] = s === "" ? null : s;
      }
    }
    if (f.required && (row[f.key] == null || row[f.key] === "")) {
      return { error: `${f.label} is required` };
    }
  }
  return { row };
}

/**
 * What a record action tells the caller. Declared, rather than inferred,
 * because requireAdmin returns a union whose error branch carries an optional
 * `error` — which `"error" in gate` cannot narrow away, so the inferred return
 * type carried shapes with no `error` at all and ModuleTable could not read
 * res.error. Optional fields rather than a discriminated union, because that
 * is the shape every caller in the OS already reads.
 */
export type RecordResult = { error?: string; success?: boolean };

export async function saveRecord(
  moduleKey: string,
  id: string | null,
  raw: Raw,
): Promise<RecordResult> {
  const gate = await requireAdmin();
  if ("error" in gate) return gate;

  const config = MODULES[moduleKey];
  if (!config || config.readOnly) return { error: "Unknown module" };

  const c = coerce(config, raw);
  if ("error" in c) return c;

  const supabase = await createClient();
  let entityId = id;
  if (id) {
    const { data: before } = await supabase.from(config.table).select("*").eq("id", id).maybeSingle();
    const { data, error } = await supabase.from(config.table).update(c.row).eq("id", id).select().maybeSingle();
    if (error) return { error: error.message };
    await audit(supabase, gate.user.id, "update", config.table, id, before, data);
  } else {
    const { data, error } = await supabase.from(config.table).insert(c.row).select().maybeSingle();
    if (error) return { error: error.message };
    entityId = (data as { id?: string })?.id ?? null;
    await audit(supabase, gate.user.id, "insert", config.table, entityId, null, data);
  }

  revalidatePath(`/shreex/${moduleKey}`);
  revalidatePath("/shreex/dashboard");
  return { success: true };
}

export async function deleteRecord(moduleKey: string, id: string): Promise<RecordResult> {
  const gate = await requireAdmin();
  if ("error" in gate) return gate;

  const config = MODULES[moduleKey];
  if (!config || config.readOnly) return { error: "Unknown module" };

  const supabase = await createClient();
  const { data: before } = await supabase.from(config.table).select("*").eq("id", id).maybeSingle();
  const { error } = await supabase.from(config.table).delete().eq("id", id);
  if (error) return { error: error.message };
  await audit(supabase, gate.user.id, "delete", config.table, id, before, null);

  revalidatePath(`/shreex/${moduleKey}`);
  revalidatePath("/shreex/dashboard");
  return { success: true };
}

async function audit(
  supabase: Awaited<ReturnType<typeof createClient>>,
  userId: string,
  action: string,
  entity: string,
  entityId: string | null,
  before: unknown,
  after: unknown,
) {
  await supabase.from("audit_log").insert({
    user_id: userId,
    action,
    entity,
    entity_id: entityId,
    before: before ?? null,
    after: after ?? null,
  });
}
