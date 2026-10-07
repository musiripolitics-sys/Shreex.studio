"use client";

import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { Icon } from "@/components/Icon";
import { scanTicket, type ScanResult } from "./actions";

export type DoorRegistration = {
  id: string;
  attendee_name: string | null;
  attendee_email: string | null;
  ticket_code: string | null;
  status: string;
  checked_in_at: string | null;
};

type Verdict = {
  tone: "ok" | "already" | "invalid";
  headline: string;
  detail: string;
  at: number;
};

// A BarcodeDetector exists in Chrome and Android WebView and nowhere else yet,
// so the camera is an enhancement and typing a code is the real interface.
type DetectedBarcode = { rawValue: string };
type BarcodeDetectorLike = { detect(source: CanvasImageSource): Promise<DetectedBarcode[]> };
declare global {
  interface Window {
    BarcodeDetector?: new (opts?: { formats?: string[] }) => BarcodeDetectorLike;
  }
}

const QUEUE_KEY = (eventId: string) => `txf.door.queue.${eventId}`;

/**
 * The offline queue and the network flag are both state owned by the browser,
 * not by React, so they are read as external stores. Pulling them in through
 * an effect would mean setting state during mount, which is the cascade the
 * lint rule is there to stop — and useSyncExternalStore is what it is for.
 */
const listeners = new Set<() => void>();
const announce = () => listeners.forEach((l) => l());
const subscribeStorage = (cb: () => void) => {
  listeners.add(cb);
  return () => void listeners.delete(cb);
};

let cachedRaw: string | null = null;
let cachedQueue: string[] = [];

function readQueue(key: string): string[] {
  try {
    const raw = localStorage.getItem(key);
    // Parsing on every render would return a new array each time and spin
    // useSyncExternalStore forever, so the parse is memoised on the raw text.
    if (raw !== cachedRaw) {
      cachedRaw = raw;
      cachedQueue = raw ? (JSON.parse(raw) as string[]) : [];
    }
    return cachedQueue;
  } catch {
    return cachedQueue;
  }
}

const EMPTY: string[] = [];

function writeQueue(key: string, next: string[]) {
  try {
    localStorage.setItem(key, JSON.stringify(next));
  } catch {
    // Private browsing, or storage disabled. The door still works; it just
    // cannot remember across a reload.
  }
  cachedRaw = null;
  announce();
}

const subscribeOnline = (cb: () => void) => {
  window.addEventListener("online", cb);
  window.addEventListener("offline", cb);
  return () => {
    window.removeEventListener("online", cb);
    window.removeEventListener("offline", cb);
  };
};

/**
 * Door check-in.
 *
 * Three things matter at a door and none of them is features: it has to answer
 * instantly, it has to be readable at arm's length in bad light, and it has to
 * keep working when the venue wifi does not. So the verdict is a full-width
 * colour block rather than a toast, the local list answers before the server
 * does, and anything that cannot reach the server is queued and replayed.
 *
 * The server stays the authority. The local list decides what to show; whether
 * a ticket is actually spent is settled by check_in_ticket, which is also what
 * makes two doors scanning at once safe.
 */
export function CheckinScanner({
  event,
  initial,
}: {
  event: { id: string; title: string; date: string; venue: string | null; city: string; capacity: number };
  initial: DoorRegistration[];
}) {
  const [rows, setRows] = useState<DoorRegistration[]>(initial);
  const [code, setCode] = useState("");
  const [verdict, setVerdict] = useState<Verdict | null>(null);
  const [scanning, setScanning] = useState(false);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [q, setQ] = useState("");

  const online = useSyncExternalStore(subscribeOnline, () => navigator.onLine, () => true);
  const queued = useSyncExternalStore(
    subscribeStorage,
    () => readQueue(QUEUE_KEY(event.id)),
    () => EMPTY,
  );

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const lastScan = useRef<{ code: string; at: number }>({ code: "", at: 0 });

  const byCode = useMemo(() => {
    const m = new Map<string, DoorRegistration>();
    for (const r of rows) if (r.ticket_code) m.set(r.ticket_code.toLowerCase(), r);
    return m;
  }, [rows]);

  const stats = useMemo(() => {
    const inCount = rows.filter((r) => r.checked_in_at || r.status === "attended").length;
    return { in: inCount, total: rows.length };
  }, [rows]);

  const persistQueue = useCallback(
    (next: string[]) => writeQueue(QUEUE_KEY(event.id), next),
    [event.id],
  );

  const markLocally = useCallback((ticket: string) => {
    setRows((prev) =>
      prev.map((r) =>
        r.ticket_code?.toLowerCase() === ticket.toLowerCase()
          ? { ...r, checked_in_at: new Date().toISOString(), status: "attended" }
          : r,
      ),
    );
  }, []);

  const show = (tone: Verdict["tone"], headline: string, detail: string) =>
    setVerdict({ tone, headline, detail, at: Date.now() });

  /** One scan, answered from the local list first and confirmed after. */
  const submit = useCallback(
    async (raw: string) => {
      const ticket = raw.trim();
      if (!ticket) return;

      // A camera sees the same code thirty times a second.
      const now = Date.now();
      if (lastScan.current.code === ticket && now - lastScan.current.at < 2500) return;
      lastScan.current = { code: ticket, at: now };

      const known = byCode.get(ticket.toLowerCase());
      if (!known) {
        show("invalid", "Not on the list", `${ticket} is not a ticket for this event.`);
        return;
      }
      if (known.checked_in_at || known.status === "attended") {
        show("already", "Already in", `${known.attendee_name ?? "This ticket"} was checked in already.`);
        return;
      }

      // Answer now, reconcile after: at a door, waiting is the failure.
      markLocally(ticket);
      show("ok", known.attendee_name ?? "Checked in", "Let them in.");

      if (!navigator.onLine) {
        persistQueue([...queued, ticket]);
        return;
      }
      try {
        const res: ScanResult = await scanTicket(ticket, event.id);
        if (res.status === "invalid") {
          // The server disagreed, so put it back and say so.
          setRows((prev) =>
            prev.map((r) =>
              r.ticket_code?.toLowerCase() === ticket.toLowerCase()
                ? { ...r, checked_in_at: null, status: "registered" }
                : r,
            ),
          );
          show("invalid", "Refused", res.message);
        } else if (res.status === "already") {
          show("already", "Already in", `${res.attendeeName ?? "This ticket"} was checked in already.`);
        }
      } catch {
        persistQueue([...queued, ticket]);
      }
    },
    [byCode, event.id, markLocally, persistQueue, queued],
  );

  // ── Replay whatever the network ate ──
  useEffect(() => {
    if (!online || queued.length === 0) return;
    let cancelled = false;
    (async () => {
      const remaining: string[] = [];
      for (const ticket of queued) {
        try {
          const res = await scanTicket(ticket, event.id);
          if (res.status === "invalid" && /network|fetch/i.test(res.message)) remaining.push(ticket);
        } catch {
          remaining.push(ticket);
        }
      }
      if (!cancelled) persistQueue(remaining);
    })();
    return () => {
      cancelled = true;
    };
    // Only when connectivity returns, not on every queue change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [online]);

  // ── Camera ──
  const stopCamera = useCallback(() => {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    setScanning(false);
  }, []);

  const startCamera = useCallback(async () => {
    setCameraError(null);
    if (!window.BarcodeDetector) {
      setCameraError("This browser cannot read QR codes. Type the code instead — Chrome on Android can scan.");
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: "environment" },
      });
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
      }
      setScanning(true);
    } catch {
      setCameraError("No camera, or permission was refused. Type the code instead.");
    }
  }, []);

  useEffect(() => {
    if (!scanning || !window.BarcodeDetector) return;
    const detector = new window.BarcodeDetector({ formats: ["qr_code", "code_128"] });
    let raf = 0;
    let stop = false;

    const tick = async () => {
      if (stop) return;
      const video = videoRef.current;
      if (video && video.readyState === 4) {
        try {
          const found = await detector.detect(video);
          if (found[0]?.rawValue) await submit(found[0].rawValue);
        } catch {
          // A frame that will not decode is the normal case, not an error.
        }
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => {
      stop = true;
      cancelAnimationFrame(raf);
    };
  }, [scanning, submit]);

  useEffect(() => stopCamera, [stopCamera]);

  const shown = useMemo(() => {
    const needle = q.trim().toLowerCase();
    if (!needle) return [];
    return rows
      .filter((r) =>
        [r.attendee_name, r.attendee_email, r.ticket_code].some((v) =>
          (v ?? "").toLowerCase().includes(needle),
        ),
      )
      .slice(0, 8);
  }, [rows, q]);

  const TONE = {
    ok: "bg-green-600 text-white",
    already: "bg-amber-500 text-white",
    invalid: "bg-red-600 text-white",
  } as const;

  return (
    <div className="mx-auto max-w-2xl">
      {/* ── Where we are ── */}
      <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="font-display text-xl font-bold tracking-tight text-fg">{event.title}</h1>
          <p className="text-sm text-muted">
            {event.venue ? `${event.venue}, ` : ""}
            {event.city}
          </p>
        </div>
        <div className="text-right">
          <p className="font-display text-2xl font-bold tabular-nums text-fg">
            {stats.in} <span className="text-base font-normal text-faint">/ {stats.total}</span>
          </p>
          <p className="text-[11px] uppercase tracking-wider text-faint">checked in</p>
        </div>
      </div>

      {(!online || queued.length > 0) && (
        <p className="mb-3 rounded-xl bg-amber-500/10 px-3 py-2 text-xs text-amber-700">
          {online
            ? `Catching up on ${queued.length} scan${queued.length === 1 ? "" : "s"} taken while offline.`
            : `Offline — still scanning. ${queued.length} waiting to sync, and nothing is lost.`}
        </p>
      )}

      {/* ── The verdict, big enough to read at arm's length ── */}
      <div
        className={`mb-4 flex min-h-[7rem] flex-col items-center justify-center rounded-2xl px-5 py-6 text-center transition-colors ${
          verdict ? TONE[verdict.tone] : "border border-dashed border-line bg-surface-2 text-muted"
        }`}
        aria-live="assertive"
      >
        {verdict ? (
          <>
            <p className="font-display text-2xl font-bold leading-tight">{verdict.headline}</p>
            <p className="mt-1 text-sm opacity-90">{verdict.detail}</p>
          </>
        ) : (
          <p className="text-sm">Scan a ticket, or type the code below.</p>
        )}
      </div>

      {/* ── Camera ── */}
      <div className="mb-4">
        {scanning ? (
          <div className="relative overflow-hidden rounded-2xl border border-line bg-black">
            <video ref={videoRef} playsInline muted className="h-64 w-full object-cover" />
            <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
              <div className="h-40 w-40 rounded-2xl border-4 border-white/70" />
            </div>
            <button
              onClick={stopCamera}
              className="absolute bottom-3 right-3 rounded-full bg-black/60 px-3 py-1.5 text-xs font-medium text-white"
            >
              Stop camera
            </button>
          </div>
        ) : (
          <button
            onClick={startCamera}
            className="flex w-full items-center justify-center gap-2 rounded-2xl border border-line bg-surface py-4 text-sm font-medium text-fg hover:border-brand hover:text-brand"
          >
            <Icon name="ticket" className="h-4 w-4" strokeWidth={1.8} />
            Scan with the camera
          </button>
        )}
        {cameraError && <p className="mt-2 text-xs text-muted">{cameraError}</p>}
      </div>

      {/* ── Typing a code is the reliable path, so it is always here ── */}
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void submit(code);
          setCode("");
          inputRef.current?.focus();
        }}
        className="mb-4 flex gap-2"
      >
        <input
          ref={inputRef}
          value={code}
          onChange={(e) => setCode(e.target.value)}
          placeholder="TXF-ABC123"
          autoComplete="off"
          autoCapitalize="characters"
          className="flex-1 rounded-xl border border-line bg-surface px-4 py-3 font-mono text-base uppercase text-fg outline-none focus:border-brand"
        />
        <button type="submit" className="rounded-xl bg-brand px-5 py-3 text-sm font-medium text-white">
          Check in
        </button>
      </form>

      {/* ── Somebody who lost their ticket ── */}
      <div>
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Look someone up by name or email…"
          className="w-full rounded-xl border border-line bg-surface px-4 py-2.5 text-sm text-fg outline-none focus:border-brand"
        />
        {shown.length > 0 && (
          <ul className="mt-2 divide-y divide-line overflow-hidden rounded-xl border border-line">
            {shown.map((r) => {
              const inAlready = !!r.checked_in_at || r.status === "attended";
              return (
                <li key={r.id} className="flex items-center justify-between gap-3 bg-surface px-4 py-2.5">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium text-fg">{r.attendee_name ?? "—"}</p>
                    <p className="truncate text-xs text-muted">
                      {r.attendee_email} · <span className="font-mono">{r.ticket_code}</span>
                    </p>
                  </div>
                  {inAlready ? (
                    <span className="shrink-0 rounded-full bg-green-100 px-2 py-0.5 text-[11px] font-semibold text-green-700">
                      In
                    </span>
                  ) : (
                    <button
                      onClick={() => {
                        void submit(r.ticket_code ?? "");
                        setQ("");
                      }}
                      className="shrink-0 rounded-full bg-brand px-3 py-1.5 text-xs font-medium text-white"
                    >
                      Check in
                    </button>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}
