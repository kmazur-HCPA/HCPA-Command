import { useEffect, useState } from "react";
import type { AppClient } from "../../platform/supabase";
import { loadSitrep, recordStatus, type SitrepState } from "../../services/sitrep";
import { flaggedMail } from "../../services/mail";
import type { RecordState } from "./reconcile";
import { sections } from "./sections";

// Loads the latest SITREP plus the live record and flagged-mail state needed to reconcile it.
export function useSitrep(client: AppClient, date: string) {
  const [state, setState] = useState<SitrepState | null>(null),
    [error, setError] = useState(""),
    [live, setLive] = useState<{ records: Map<string, RecordState>; openFlagged: Set<string> | null }>({ records: new Map(), openFlagged: null }),
    [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    let alive = true;
    const refresh = () =>
      loadSitrep(client, date)
        .then(async (next) => {
          const payload = next.run?.payload;
          const refs = payload
            ? sections.slice(1).flatMap(([k]) => payload[k as "next"].flatMap((i) => i.refs ?? []))
            : [];
          const ids = [...new Set(refs.filter((r) => r.kind === "record").map((r) => r.id))];
          const [records, openFlagged] = await Promise.all([
            recordStatus(client, ids).catch(() => new Map<string, RecordState>()),
            refs.some((r) => r.kind === "email")
              ? flaggedMail(client)
                  .then((f) => (f.truncated ? null : new Set(f.messages.filter((m) => !m.capture).map((m) => m.id))))
                  .catch(() => null)
              : Promise.resolve(null),
          ]);
          if (alive) {
            setState(next);
            setLive({ records, openFlagged });
            setNow(Date.now());
            setError("");
          }
        })
        .catch((caught: Error) => {
          if (alive) setError(caught.message);
        });
    void refresh();
    const timer = setInterval(() => {
      if (document.visibilityState === "visible") void refresh();
    }, 60000);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, [client, date]);
  return { state, error, live, now };
}
