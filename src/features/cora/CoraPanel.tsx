import { useEffect, useRef, useState } from "react";
import type { AppClient } from "../../platform/supabase";
import type { CoraContext, CoraTurn, CoraConversation } from "./model";
import { microsoftSourceLink } from "../microsoft/model";
import { chat, history, createTask } from "./service";
import { Mark, Icon } from "../../ui/Icon";
import { useDraftGuard } from "../work/useDraftGuard";
export function CoraPanel({
  client,
  open,
  context,
  onClose,
  onOpen,
  onCreated,
  onDirty,
  prompt,
  initialConversation,
}: {
  client: AppClient;
  open: boolean;
  context: CoraContext;
  onClose: () => void;
  onOpen: (row: { id: string }) => void;
  onCreated: () => void;
  onDirty: (dirty: boolean) => void;
  prompt?: string;
  initialConversation?: string;
}) {
  const dialog = useRef<HTMLDialogElement>(null),
    input = useRef<HTMLTextAreaElement>(null),
    scroller = useRef<HTMLDivElement>(null),
    abort = useRef<AbortController | null>(null);
  const [conversation, setConversation] = useState(
      () => initialConversation ?? crypto.randomUUID() as string,
    ),
    [turns, setTurns] = useState<CoraTurn[]>([]),
    [conversations, setConversations] = useState<CoraConversation[]>([]);
  const [draft, setDraft] = useState(prompt ?? ""),
    [busy, setBusy] = useState(false),
    [loading, setLoading] = useState(!!initialConversation),
    [status, setStatus] = useState(""),
    [partial, setPartial] = useState(""),
    [pending, setPending] = useState(""),
    [error, setError] = useState(""),
    [action, setAction] = useState(""),
    [older, setOlder] = useState(false),
    [listMore, setListMore] = useState(false);
  useDraftGuard(busy || !!action || !!draft.trim());
  useEffect(() => () => abort.current?.abort(), []);
  useEffect(() => {
    if (!initialConversation) return;
    let active = true;
    void history(client, initialConversation).then(data => {
      if (active) { setTurns((data.turns ?? []).reverse()); setOlder(data.turns?.length === 20); }
    }).catch(() => { if(active) setError('This proposal could not be loaded. Use Reload history to retry.'); }).finally(() => { if(active) setLoading(false); });
    return () => { active = false; };
  }, [client, initialConversation]);
  const [lastPrompt, setLastPrompt] = useState(prompt);
  if (prompt !== lastPrompt) {
    setLastPrompt(prompt);
    if (prompt && !draft) setDraft(prompt);
  }
  useEffect(
    () => onDirty(busy || !!action || !!draft.trim()),
    [busy, action, draft, onDirty],
  );
  useEffect(() => {
    const element = dialog.current;
    if (!element) return;
    if (!open) {
      element.close();
      return;
    }
    const previous = document.activeElement as HTMLElement | null;
    const mobile = matchMedia("(max-width: 700px)").matches;
    if (mobile) element.showModal();
    else element.show();
    input.current?.focus();
    return () => {
      element.close();
      previous?.focus();
    };
  }, [open]);
  useEffect(() => {
    if (open) {
      let alive = true;
      void history(client)
        .then((data) => {
          if (alive) {
            setConversations(data.conversations ?? []);
            setListMore(data.conversations?.length === 20);
          }
        })
        .catch((e) => {
          if (alive) setError(e.message);
        });
      return () => {
        alive = false;
      };
    }
  }, [client, open]);
  useEffect(() => {
    scroller.current?.scrollTo({
      top: scroller.current.scrollHeight,
      behavior: "instant",
    });
  }, [partial, turns.length, pending]);
  async function load(id = conversation, more = false) {
    if (busy || loading) return;
    setLoading(true);
    setError("");
    try {
      const data = await history(client, id, more ? turns.length : 0);
      setConversation(id);
      setTurns((old) =>
        more
          ? [...(data.turns ?? []).reverse(), ...old]
          : (data.turns ?? []).reverse(),
      );
      setOlder(data.turns?.length === 20);
      setPartial("");
      setPending("");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }
  async function send(event?: React.FormEvent) {
    event?.preventDefault();
    if (busy || !draft.trim()) return;
    const message = draft.trim();
    setDraft("");
    setPending(message);
    setPartial("");
    setError("");
    setBusy(true);
    setStatus("Getting ready…");
    abort.current = new AbortController();
    try {
      await chat(
        client,
        {
          message,
          requestId: crypto.randomUUID(),
          conversationId: conversation,
          context,
        },
        abort.current.signal,
        (event) => {
          if (event.type === "status") setStatus(event.message);
          if (event.type === "delta") setPartial((p) => p + event.text);
          if (event.type === "error") setError(event.message);
          if (event.type === "complete") {
            setTurns((old) => [
              ...old.filter((t) => t.id !== event.turn.id),
              event.turn,
            ]);
            setPartial("");
            setPending("");
            setStatus("");
          }
        },
      );
    } catch (e) {
      setError(
        abort.current.signal.aborted
          ? "Stopped. Reload history to check the final response. No task was created."
          : (e as Error).message,
      );
    } finally {
      setBusy(false);
      setStatus("");
      input.current?.focus();
    }
  }
  async function confirm(turn: CoraTurn) {
    if (action) return;
    setAction(turn.id);
    setError("");
    try {
      await createTask(client, turn.id);
      setTurns((old) =>
        old.map((t) =>
          t.id === turn.id ? { ...t, action_status: "created" } : t,
        ),
      );
      onCreated();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setAction("");
    }
  }
  return (
    <dialog
      ref={dialog}
      className="cora-panel"
      aria-label="Cora"
      onCancel={onClose}
      onKeyDown={(event) => {
        if (event.key === "Escape") {
          event.preventDefault();
          onClose();
        }
      }}
    >
      <header className="cora-heading">
        <span className={busy ? "cora-mark is-active" : "cora-mark"}>
          <Mark />
        </span>
        <div>
          <h2>Cora</h2>
          <p>Command intelligence</p>
        </div>
        <button
          className="icon-button"
          aria-label="Close Cora"
          onClick={onClose}
        >
          <Icon name="close" />
        </button>
      </header>
      <div className="cora-toolbar">
        <button
          disabled={busy || loading || !!draft.trim()}
          onClick={() => {
            setConversation(crypto.randomUUID());
            setTurns([]);
            setPartial("");
            setPending("");
            setError("");
            setOlder(false);
          }}
        >
          New conversation
        </button>
        <button disabled={busy || loading} onClick={() => void load()}>
          Reload history
        </button>
      </div>
      <label className="cora-history">
        Conversations
        <select
          disabled={busy || loading || !!draft.trim()}
          value={
            conversations.some((c) => c.id === conversation) ? conversation : ""
          }
          onChange={(e) => {
            if (e.target.value) void load(e.target.value);
          }}
        >
          <option value="">Current conversation</option>
          {conversations.map((c) => (
            <option key={c.id} value={c.id}>
              {c.title}
            </option>
          ))}
        </select>
      </label>
      {listMore && (
        <button
          disabled={loading}
          onClick={() => {
            setLoading(true);
            void history(client, undefined, conversations.length)
              .then((data) => {
                setConversations((old) => [
                  ...old,
                  ...(data.conversations ?? []),
                ]);
                setListMore(data.conversations?.length === 20);
              })
              .catch((e) => setError(e.message))
              .finally(() => setLoading(false));
          }}
        >
          Older conversations
        </button>
      )}
      <p className="cora-context">
        {context.recordId
          ? "Using the open record"
          : "With you in " +
            (context.page === "workspace" ? "Work Day" : context.page)}{" "}
        · Live Command data
      </p>
      <div ref={scroller} className="cora-messages">
        {older && (
          <button
            disabled={busy || loading}
            onClick={() => void load(conversation, true)}
          >
            Earlier messages
          </button>
        )}
        {!turns.length && !pending && (
          <div className="cora-welcome">
            <p className="eyebrow">A little perspective.</p>
            <h3>What needs your attention?</h3>
            <p>
              I can connect your tasks, projects and loose ends. Start wherever
              you are.
            </p>
            <div className="cora-suggestions">
              {[
                context.recordId
                  ? "What's going on with this?"
                  : "What needs my attention today?",
                "What tasks do I have open?",
                "What's waiting on someone else?",
                "Add a task for tomorrow to follow up with Erik.",
              ].map((text) => (
                <button
                  key={text}
                  onClick={() => {
                    setDraft(text);
                    input.current?.focus();
                  }}
                >
                  {text}
                  <Icon name="arrow" />
                </button>
              ))}
            </div>
          </div>
        )}
        {turns.map((turn) => (
          <article className="cora-turn" key={turn.id}>
            <p className="cora-user">
              <span className="sr-only">You: </span>
              {turn.message}
            </p>
            <div className="cora-answer">
              <p className="eyebrow">Cora</p>
              <p className="cora-text">
                {turn.response ||
                  "This request is still running or was interrupted. Reload history to check."}
              </p>
              {turn.status === "error" && (
                <small>Response did not complete.</small>
              )}
              {turn.sources.length > 0 && (
                <details className="cora-sources">
                  <summary>Command sources · {turn.sources.length}</summary>
                  {turn.sources.map((source) => (
                    (source.kind.startsWith("outlook_") || source.kind.startsWith("teams_")) ? (microsoftSourceLink(source.kind, source.url) ? <a key={source.id} href={microsoftSourceLink(source.kind, source.url)} target="_blank" rel="noopener noreferrer">{source.title}<Icon name="arrow" /></a> : null) : <button
                      key={source.id}
                      onClick={() => {
                        onOpen(source);
                        if (matchMedia("(max-width:700px)").matches) onClose();
                      }}
                    >
                      {source.title}
                      <Icon name="arrow" />
                    </button>
                  ))}
                </details>
              )}
            </div>
            {turn.proposal && (
              <section className="cora-task-card" aria-label="Task proposal">
                <p className="eyebrow">
                  {turn.action_status === "created"
                    ? "Task created"
                    : "Ready to add · Task"}
                </p>
                <h3>{turn.proposal.title}</h3>
                <p>
                  {turn.proposal.due_date
                    ? "Due " + turn.proposal.due_date
                    : "No due date"}{" "}
                  · {turn.proposal.priority} priority
                </p>
                {turn.proposal.project_id && (
                  <button
                    onClick={() => onOpen({ id: turn.proposal!.project_id! })}
                  >
                    View linked project
                  </button>
                )}
                {turn.action_status === "created" ? (
                  <button onClick={() => onOpen({ id: turn.task_id })}>
                    Open task
                    <Icon name="arrow" />
                  </button>
                ) : (
                  <button
                    disabled={!!action || busy}
                    onClick={() => void confirm(turn)}
                  >
                    {action === turn.id ? "Adding task…" : "Add task"}
                  </button>
                )}
              </section>
            )}
          </article>
        ))}
        {pending && (
          <article className="cora-turn">
            <p className="cora-user">{pending}</p>
            {partial && <p className="cora-text">{partial}</p>}
            {error && (
              <small>
                Unconfirmed response · reload history before resending.
              </small>
            )}
          </article>
        )}
      </div>
      {status && (
        <p role="status" className="cora-status">
          <span /> {status}
        </p>
      )}
      {error && (
        <p role="alert" className="error-message">
          {error}
        </p>
      )}
      <form className="cora-composer" onSubmit={(e) => void send(e)}>
        <label className="sr-only" htmlFor="cora-message">
          Ask Cora
        </label>
        <textarea
          ref={input}
          id="cora-message"
          value={draft}
          maxLength={4000}
          rows={3}
          placeholder="Ask Cora…"
          disabled={busy}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (
              e.key === "Enter" &&
              !e.shiftKey &&
              !e.nativeEvent.isComposing
            ) {
              e.preventDefault();
              void send();
            }
          }}
        />
        <div>
          <small>Enter to send · Shift+Enter for a new line</small>
          {busy ? (
            <button type="button" onClick={() => abort.current?.abort()}>
              Stop
            </button>
          ) : (
            <button
              type="submit"
              disabled={!draft.trim() || loading}
              aria-label="Send to Cora"
            >
              <Icon name="arrow" />
            </button>
          )}
        </div>
      </form>
    </dialog>
  );
}
