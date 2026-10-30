"use client";

import { useState, useTransition } from "react";
import { saveNotificationPreferences, type NotificationPrefs } from "@/lib/actions/collaboration";

const ROWS: { key: keyof NotificationPrefs; label: string; hint: string }[] = [
  { key: "emailAssignments", label: "Assignments", hint: "When an exception or close task is assigned to you." },
  { key: "emailReviews", label: "Reviews", hint: "When your review is requested, or your work is approved or sent back." },
  { key: "emailMentions", label: "Mentions", hint: "When someone @mentions you in a comment." },
  { key: "emailReminders", label: "Reminders", hint: "Upcoming deadlines such as VAT returns and period closes." },
];

/** Notifications always appear in the app; these switches control which also arrive by email. */
export function NotificationPreferencesForm({ initial, emailConfigured }: { initial: NotificationPrefs; emailConfigured: boolean }) {
  const [prefs, setPrefs] = useState(initial);
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState<string | null>(null);

  const toggle = (key: keyof NotificationPrefs) => {
    const next = { ...prefs, [key]: !prefs[key] };
    setPrefs(next);
    setMessage(null);
    startTransition(async () => {
      const res = await saveNotificationPreferences(next);
      setMessage(res.error ?? "Saved.");
    });
  };

  return (
    <div className="space-y-3">
      {!emailConfigured && (
        <p className="rounded-lg border border-status-pending/30 bg-status-pendingBg px-4 py-3 text-sm text-ink-800">
          Email sending isn&apos;t set up for this site yet, so notifications appear in the app only.
        </p>
      )}
      <ul className="divide-y divide-ink-100">
        {ROWS.map((r) => (
          <li key={r.key} className="flex items-start justify-between gap-4 py-3">
            <div>
              <p className="text-sm font-medium text-ink-900">{r.label}</p>
              <p className="text-xs text-ink-500">{r.hint}</p>
            </div>
            <label className="relative inline-flex cursor-pointer items-center">
              <input type="checkbox" checked={prefs[r.key]} disabled={pending} onChange={() => toggle(r.key)} className="peer sr-only" aria-label={`Email me about ${r.label.toLowerCase()}`} />
              <span className="h-6 w-11 rounded-full bg-ink-200 transition peer-checked:bg-accent-500 peer-focus-visible:ring-2 peer-focus-visible:ring-accent-500" />
              <span className="absolute left-0.5 top-0.5 h-5 w-5 rounded-full bg-white shadow transition peer-checked:translate-x-5" />
            </label>
          </li>
        ))}
      </ul>
      {message && <p className="text-xs text-ink-500">{message}</p>}
    </div>
  );
}
