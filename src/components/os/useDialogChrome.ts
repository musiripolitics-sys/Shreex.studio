"use client";

import { useEffect } from "react";

/**
 * The two things every dialog in the OS owes the page behind it: Escape
 * closes, and the page underneath stops scrolling.
 *
 * The task panel had neither. Opening it on the roadmap and then using the
 * wheel scrolled the roadmap behind the fixed overlay, which detached the
 * sticky sidebar and header and looked, reasonably enough, like the UI had
 * broken.
 *
 * The lock is reference counted. A plain `overflow = ""` on unmount is wrong
 * as soon as two dialogs overlap, because the first one to close unlocks the
 * page while the second is still up.
 */
let depth = 0;
let restore = "";

export function useDialogChrome(open: boolean, onClose: () => void) {
  useEffect(() => {
    if (!open) return;

    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);

    if (depth === 0) {
      restore = document.body.style.overflow;
      document.body.style.overflow = "hidden";
    }
    depth += 1;

    return () => {
      window.removeEventListener("keydown", onKey);
      depth -= 1;
      if (depth === 0) document.body.style.overflow = restore;
    };
  }, [open, onClose]);
}
