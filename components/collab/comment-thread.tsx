"use client";

import { useCallback, useEffect, useState, useTransition } from "react";
import { addComment, deleteComment, listComments, type CommentItem, type CommentTarget } from "@/lib/actions/collaboration";
import { timeAgo } from "@/lib/time-ago";
import { Button } from "@/components/ui/button";

/** A discussion attached to one item. Write @name (the part of someone's email before the @) to notify them. */
export function CommentThread({ type, id, canComment, title = "Discussion" }: { type: CommentTarget; id: string; canComment: boolean; title?: string }) {
  const [comments, setComments] = useState<CommentItem[] | null>(null);
  const [text, setText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const load = useCallback(async () => {
    try {
      setComments(await listComments(type, id));
    } catch {
      setComments([]);
    }
  }, [type, id]);

  useEffect(() => {
    void load();
  }, [load]);

  const post = () => {
    setError(null);
    startTransition(async () => {
      const res = await addComment(type, id, text);
      if (res.error) setError(res.error);
      else {
        setText("");
        await load();
      }
    });
  };

  return (
    <section className="space-y-3">
      <h3 className="text-sm font-semibold text-ink-900">
        {title}
        {comments && comments.length > 0 ? <span className="ml-1.5 font-normal text-ink-500">({comments.length})</span> : null}
      </h3>

      {comments === null ? (
        <p className="text-sm text-ink-500">Loading…</p>
      ) : comments.length === 0 ? (
        <p className="text-sm text-ink-500">No comments yet.</p>
      ) : (
        <ul className="space-y-3">
          {comments.map((c) => (
            <li key={c.id} className="rounded-lg bg-ink-50 px-3.5 py-2.5">
              <div className="flex items-center justify-between gap-3">
                <p className="text-xs font-medium text-ink-800">
                  {c.authorEmail.split("@")[0]} <span className="font-normal text-ink-400">· {timeAgo(c.createdAt)}</span>
                </p>
                {c.mine && (
                  <button
                    type="button"
                    onClick={async () => {
                      if (!window.confirm("Delete your comment?")) return;
                      await deleteComment(c.id);
                      await load();
                    }}
                    className="text-xs text-ink-400 hover:text-status-exception"
                  >
                    Delete
                  </button>
                )}
              </div>
              <p className="mt-1 whitespace-pre-wrap break-words text-sm text-ink-900">{c.body}</p>
            </li>
          ))}
        </ul>
      )}

      {canComment && (
        <div className="space-y-2">
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            rows={2}
            maxLength={2000}
            placeholder="Write a comment. Use @name to notify someone."
            className="w-full rounded border border-ink-200 p-2.5 text-sm text-ink-900 placeholder:text-ink-400 focus:border-accent-500 focus:outline-none focus:ring-1 focus:ring-accent-500"
          />
          {error && <p className="text-sm text-status-exception">{error}</p>}
          <Button size="sm" loading={pending} disabled={!text.trim()} onClick={post}>
            Post comment
          </Button>
        </div>
      )}
    </section>
  );
}
