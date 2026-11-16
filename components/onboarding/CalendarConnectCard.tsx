"use client";

import { useState } from "react";
import Button from "@/components/ui/Button";
import Card from "@/components/ui/Card";

interface Props {
  configured: boolean;
  status: "none" | "pending" | "connected" | "revoked";
  justReturned: "connected" | "failed" | null;
}

/** Individual teachers: link a calendar through the Keeper.sh MCP server. */
export default function CalendarConnectCard({ configured, status, justReturned }: Props) {
  const [current, setCurrent] = useState(status);
  const [message, setMessage] = useState<string | null>(
    justReturned === "failed" ? "The calendar did not connect. Try again." : null,
  );
  const [busy, setBusy] = useState(false);

  async function act(action: "connect" | "check" | "disconnect") {
    setBusy(true);
    setMessage(null);
    try {
      const response = await fetch("/api/calendar", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action }),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) {
        setMessage(typeof body.error === "string" ? body.error : "Something went wrong");
        return;
      }
      if (action === "connect") {
        if (body.status === "redirect") {
          window.location.href = body.authorization_url;
          return;
        }
        setCurrent("connected");
      } else if (action === "check") {
        setMessage(
          body.events_next_24h === null
            ? "Keeper answered. The calendar link works."
            : `The calendar link works. ${body.events_next_24h} event(s) in the next 24 hours.`,
        );
      } else {
        setCurrent("revoked");
      }
    } finally {
      setBusy(false);
    }
  }

  const connected = current === "connected";
  return (
    <Card className="p-6">
      <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">Connect your calendar</h2>
      <p className="mt-2 text-sm text-gray-600 dark:text-gray-300">
        DIRA uses your calendar only for timing: when your sessions happen, so it can ask about them
        afterwards. It reads how many events you have and when. It does not keep event titles, guests
        or notes, and it never writes to your calendar. The link goes through Keeper, which supports
        Google Calendar, Outlook, iCloud and others.
      </p>
      {!connected && (
        <div className="mt-3 rounded-md border border-dira-amber/60 bg-dira-amber/10 p-3 text-sm text-gray-800 dark:text-gray-200">
          <p className="font-medium">Before you connect, you need a free Keeper account.</p>
          <ol className="mt-1 list-decimal space-y-0.5 pl-5">
            <li>
              Create one at{" "}
              <a
                href="https://www.keeper.sh"
                target="_blank"
                rel="noopener noreferrer"
                className="font-medium text-dira-teal underline dark:text-dira-amber"
              >
                keeper.sh
              </a>{" "}
              (opens in a new tab).
            </li>
            <li>In Keeper, add the calendar you teach from (Google, Outlook, iCloud or similar).</li>
            <li>Come back here and click Connect with Keeper. Keeper will ask you to approve read-only access.</li>
          </ol>
        </div>
      )}
      {!configured && (
        <p className="mt-3 text-sm text-amber-700 dark:text-amber-400">
          Calendar connection is not switched on for this server yet.
        </p>
      )}
      {message && (
        <p role="status" className="mt-3 text-sm text-gray-800 dark:text-gray-200">
          {message}
        </p>
      )}
      {justReturned === "connected" && !message && (
        <p role="status" className="mt-3 text-sm text-green-700 dark:text-green-400">
          Your calendar is connected.
        </p>
      )}
      <div className="mt-4 flex flex-wrap gap-2">
        {connected ? (
          <>
            <Button type="button" disabled={busy} onClick={() => act("check")}>
              Test the connection
            </Button>
            <Button type="button" disabled={busy} onClick={() => act("disconnect")}>
              Disconnect
            </Button>
          </>
        ) : (
          <Button type="button" disabled={busy || !configured} onClick={() => act("connect")}>
            {busy ? "Opening Keeper…" : "Connect with Keeper"}
          </Button>
        )}
      </div>
    </Card>
  );
}
