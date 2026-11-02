import { useEffect, useRef, useState } from "react";
import type { ReviewItem } from "../api/types";
import { getErrorMessage, WaniKaniClient, WaniKaniError } from "../api/wanikani";

interface LessonSave {
  item: ReviewItem;
  status: "queued" | "saving" | "failed";
  error?: string;
}

export function useLessonSaves(client: WaniKaniClient, onCompleted: () => void) {
  const [saves, setSaves] = useState<LessonSave[]>([]);
  const [saved, setSaved] = useState(0);
  const active = useRef(false);
  const onCompletedRef = useRef(onCompleted);
  onCompletedRef.current = onCompleted;

  useEffect(() => {
    const next = saves.find((save) => save.status === "queued");
    if (active.current || !next) return;
    active.current = true;
    const id = next.item.assignment.id;
    setSaves((current) => current.map((save) => save.item.assignment.id === id ? { ...save, status: "saving" } : save));
    void client.startAssignment(id).then(
      () => {
        active.current = false;
        setSaved((count) => count + 1);
        setSaves((current) => current.filter((save) => save.item.assignment.id !== id));
        onCompletedRef.current();
      },
      (cause: unknown) => {
        active.current = false;
        const error = cause instanceof WaniKaniError && cause.status === 403
          ? "Your API token needs assignments:start permission. Update its permissions in WaniKani, then retry saving."
          : `Could not confirm lesson progress: ${getErrorMessage(cause)} Retry saving to check WaniKani and finish.`;
        setSaves((current) => current.map((save) => save.item.assignment.id === id ? { ...save, status: "failed", error } : save));
      },
    );
  }, [client, saves]);

  useEffect(() => {
    if (!saves.length) return;
    const beforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", beforeUnload);
    return () => window.removeEventListener("beforeunload", beforeUnload);
  }, [saves.length]);

  return {
    saves,
    saved,
    resetSaved: () => setSaved(0),
    enqueue: (item: ReviewItem) => setSaves((current) => current.some((save) => save.item.assignment.id === item.assignment.id)
      ? current : [...current, { item, status: "queued" }]),
    retry: (id: number) => setSaves((current) => current.map((save) => save.item.assignment.id === id && save.status === "failed"
      ? { ...save, status: "queued", error: undefined } : save)),
  };
}
