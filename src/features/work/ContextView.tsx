import type { WorkItem, WorkSummary } from "./model";
import { dueMeta } from "./dayModel";
import { displayDate, today } from "./dates";

const closed = ["Complete", "Cancelled", "Dismissed"];
const isOpen = (r: WorkSummary) => !closed.includes(r.status) && !r.archived;
const byDue = (a: WorkSummary, b: WorkSummary) => (a.due_date ?? "9999").localeCompare(b.due_date ?? "9999");
const newest = (a: WorkSummary, b: WorkSummary) => Date.parse(b.updated_at) - Date.parse(a.updated_at);

function Rows({ rows, date, empty }: { rows: WorkSummary[]; date: string; empty: string }) {
  if (!rows.length) return <p className="muted small ctx-empty">{empty}</p>;
  return (
    <ul className="link-rows">
      {rows.map((r) => {
        const due = dueMeta(r.due_date, date);
        return (
          <li key={r.id}>
            <a href={`/?record=${r.id}`}>{r.title}</a>
            {" · "}
            <span className={due.overdue ? "meta--overdue" : undefined}>
              {r.kind === "journal" ? displayDate(null, r.created_at).split(",")[0] : r.due_date ? due.text : r.status}
            </span>
            {r.kind !== "task" && ` · ${r.kind.replace("_", " ")}`}
            {r.kind === "task" && r.due_date ? ` · ${r.status}` : ""}
          </li>
        );
      })}
    </ul>
  );
}

// Project and initiative: summary sentence, what's next, open work, activity.
export function ProjectView({ item, related, more, onMore }: { item: WorkItem; related: WorkSummary[]; more: boolean; onMore: () => void }) {
  const date = today();
  const open = related.filter((r) => (r.kind === "task" || r.kind === "waiting") && isOpen(r)).sort(byDue);
  const next = open.slice(0, 3);
  const rest = open.slice(3);
  const activity = related.filter((r) => !open.includes(r)).sort(newest).slice(0, 8);
  const summary = item.current_state || item.goals;
  return (
    <>
      <p className="ctx-lead">{summary || "No summary yet. Use Edit to add goals and where things stand."}</p>
      {item.goals && item.current_state && <p className="meta">Goal · {item.goals}</p>}
      {item.next_milestone && <p className="meta">Next milestone · {item.next_milestone}</p>}
      <section className="ctx-section" aria-labelledby="ctx-next">
        <h2 id="ctx-next" className="label label--accent">What’s next</h2>
        <Rows rows={next} date={date} empty="Nothing open. Add a task to this project when something needs doing." />
      </section>
      {rest.length > 0 && (
        <section className="ctx-section" aria-labelledby="ctx-open">
          <h2 id="ctx-open" className="label">Open work · {rest.length}</h2>
          <Rows rows={rest} date={date} empty="" />
        </section>
      )}
      <section className="ctx-section" aria-labelledby="ctx-activity">
        <h2 id="ctx-activity" className="label">Activity</h2>
        <Rows rows={activity} date={date} empty="No activity yet." />
        {more && <button className="btn btn--ghost" onClick={onMore}>Load more related work</button>}
      </section>
    </>
  );
}

// Person: meeting-prep order — what they owe you, what you owe them, recent notes.
export function PersonView({ item, related, more, onMore }: { item: WorkItem; related: WorkSummary[]; more: boolean; onMore: () => void }) {
  const date = today();
  const waiting = related.filter((r) => r.kind === "waiting" && isOpen(r)).sort(byDue);
  const owed = related.filter((r) => (r.kind === "task" || r.kind === "reminder") && isOpen(r)).sort(byDue);
  const notes = related.filter((r) => r.kind === "journal").sort(newest).slice(0, 5);
  const first = item.title.split(/\s+/)[0];
  return (
    <>
      <section className="ctx-section" aria-labelledby="ctx-waiting">
        <h2 id="ctx-waiting" className="label label--accent">Waiting on {first}</h2>
        <Rows rows={waiting} date={date} empty={`Nothing waiting on ${first}. Track a dependency when work is in their hands.`} />
      </section>
      <section className="ctx-section" aria-labelledby="ctx-owe">
        <h2 id="ctx-owe" className="label">You owe {first}</h2>
        <Rows rows={owed} date={date} empty={`Nothing open with ${first}.`} />
      </section>
      <section className="ctx-section" aria-labelledby="ctx-notes">
        <h2 id="ctx-notes" className="label">Recent notes</h2>
        <Rows rows={notes} date={date} empty="No journal entries mention this person yet." />
        {more && <button className="btn btn--ghost" onClick={onMore}>Load more related work</button>}
      </section>
    </>
  );
}
