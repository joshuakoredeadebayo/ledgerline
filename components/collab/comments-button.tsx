"use client";

import { useState } from "react";
import { MessageSquare } from "lucide-react";
import type { CommentTarget } from "@/lib/actions/collaboration";
import { Modal, ModalContent, ModalTrigger } from "@/components/ui/modal";
import { Button } from "@/components/ui/button";
import { CommentThread } from "@/components/collab/comment-thread";

/** A small "Comments" button that opens the discussion in a popup, for rows in a list. */
export function CommentsButton({ type, id, canComment, label }: { type: CommentTarget; id: string; canComment: boolean; label: string }) {
  const [open, setOpen] = useState(false);
  return (
    <Modal open={open} onOpenChange={setOpen}>
      <ModalTrigger asChild>
        <Button type="button" size="sm" variant="ghost" aria-label={`Comments on ${label}`}>
          <MessageSquare className="h-3.5 w-3.5" />
          Comments
        </Button>
      </ModalTrigger>
      <ModalContent title="Comments" description={label}>
        {open && <CommentThread type={type} id={id} canComment={canComment} title="Discussion" />}
      </ModalContent>
    </Modal>
  );
}
