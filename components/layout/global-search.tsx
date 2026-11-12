"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { Search } from "lucide-react";
import { cn } from "@/lib/utils";

/** The search box in the top bar. Press / or Ctrl+K from anywhere to jump into it. */
export function GlobalSearch({ className }: { className?: string }) {
  const router = useRouter();
  const input = useRef<HTMLInputElement>(null);
  const [q, setQ] = useState("");

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const typing = (e.target as HTMLElement | null)?.closest("input, textarea, select, [contenteditable=true]");
      if ((e.key === "/" && !typing) || ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k")) {
        e.preventDefault();
        input.current?.focus();
        input.current?.select();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return (
    <form
      role="search"
      className={cn("relative", className)}
      onSubmit={(e) => {
        e.preventDefault();
        const term = q.trim();
        if (term.length >= 2) router.push(`/search?q=${encodeURIComponent(term)}`);
      }}
    >
      <Search className="pointer-events-none absolute left-3.5 top-1/2 h-[18px] w-[18px] -translate-y-1/2 text-accent-600" />
      <input
        ref={input}
        value={q}
        onChange={(e) => setQ(e.target.value)}
        maxLength={80}
        aria-label="Search"
        placeholder="Search anything…"
        className="h-10 w-full rounded-full border border-transparent bg-accent-50 pl-10 pr-14 text-sm text-ink-900 placeholder:text-ink-500 focus:border-accent-300 focus:bg-white focus:outline-none focus:ring-2 focus:ring-accent-100"
      />
      <kbd className="pointer-events-none absolute right-3 top-1/2 hidden -translate-y-1/2 rounded border border-ink-200 bg-white px-1.5 py-0.5 text-[10px] font-medium text-ink-400 sm:block">Ctrl K</kbd>
    </form>
  );
}
