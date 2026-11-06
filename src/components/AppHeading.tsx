/// <reference types="vite/client" />
import { useEffect, useState } from "react";
import { RefreshCw } from "lucide-react";

const APP_VERSION = import.meta.env.VITE_APP_VERSION;

type UpdateState =
  | { status: "idle" | "checking" | "current" | "error" }
  | { status: "available"; version: string; url: string };

export function AppHeading({
  warnBeforeReload = false,
}: {
  warnBeforeReload?: boolean;
}) {
  const [update, setUpdate] = useState<UpdateState>({ status: "idle" });

  useEffect(() => {
    if (update.status !== "current") return;

    const timer = window.setTimeout(() => {
      setUpdate((latest) => (latest === update ? { status: "idle" } : latest));
    }, 3000);

    return () => window.clearTimeout(timer);
  }, [update]);

  async function checkForUpdates() {
    setUpdate({ status: "checking" });

    // Fetch the deployed HTML so its version and script URLs come from the same build.
    const url = new URL(window.location.href);
    url.searchParams.set("app-update", Date.now().toString());

    try {
      const response = await fetch(url, { cache: "no-store" });
      if (!response.ok) throw new Error("Could not fetch the app page");
      const html = new DOMParser().parseFromString(
        await response.text(),
        "text/html",
      );
      const version = html
        .querySelector<HTMLMetaElement>('meta[name="app-version"]')
        ?.content.trim();
      if (!version) throw new Error("Missing app version");

      setUpdate(
        version === APP_VERSION
          ? { status: "current" }
          : { status: "available", version, url: url.href },
      );
    } catch {
      setUpdate({ status: "error" });
    }
  }

  return (
    <div>
      <p className="eyebrow">Level-up review</p>
      <div className="title-row">
        <h1>WaniKani Queue</h1>
        <button
          type="button"
          className="version-button"
          aria-label={`Check for updates (current version ${APP_VERSION})`}
          title="Check for updates"
          onClick={checkForUpdates}
          disabled={update.status === "checking"}
        >
          v{APP_VERSION}
          <RefreshCw
            size={13}
            aria-hidden="true"
            className={update.status === "checking" ? "spin" : undefined}
          />
        </button>
      </div>
      <p className="app-update-status" role="status">
        {update.status === "checking" && "Checking for updates…"}
        {update.status === "current" && "You’re up to date."}
        {update.status === "error" && "Couldn’t check for updates. Try again."}
        {update.status === "available" && (
          <>
            Version {update.version} is available.
            {warnBeforeReload && " Reloading ends the current review or lesson session."}
            {" "}<a href={update.url}>Reload to update</a>
          </>
        )}
      </p>
    </div>
  );
}
