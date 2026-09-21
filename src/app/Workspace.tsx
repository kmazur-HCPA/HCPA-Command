import { useEffect, useState, useRef } from "react";
import type { User } from "@supabase/supabase-js";
import type { AppClient } from "../platform/supabase";
import { readPreferences, saveTheme } from "../services/account";
import type { Preferences, Theme } from "../services/account";
import { signOut } from "../services/auth";
import { Detail } from "../features/work/Detail";
import type { Kind, WorkItem } from "../features/work/model";
import { Icon, Mark } from "../ui/Icon";
import { navigation } from "../ui/navigation";
import { Palette } from "../ui/Palette";
import { WorkList } from "../features/work/WorkList";
import { WorkDay } from "../features/work/WorkDay";
import { Capture } from "../features/work/Capture";
import { Drafts } from "../features/work/Drafts";
import { Lab } from "../features/lab/Lab";
import { listDrafts } from "../platform/drafts";

export function Workspace({ client, user }: { client: AppClient; user: User }) {
  const [page, setPage] = useState<"workspace" | "settings" | "lab" | Kind>(
    "workspace",
  );
  const [capture, setCapture] = useState(false);
  const [palette, setPalette] = useState(false),
    [more, setMore] = useState(false);
  const moreDialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    if (more) moreDialog.current?.showModal();
  }, [more]);
  useEffect(() => {
    const shortcut = (event: KeyboardEvent) => {
      if (
        (event.metaKey || event.ctrlKey) &&
        event.key.toLowerCase() === "k" &&
        !document.querySelector("dialog[open]")
      ) {
        event.preventDefault();
        if (event.shiftKey) setCapture(true);
        else setPalette(true);
      }
    };
    window.addEventListener("keydown", shortcut);
    return () => window.removeEventListener("keydown", shortcut);
  }, []);
  useEffect(() => {
    const open = () => setCapture(true);
    window.addEventListener("command:capture", open);
    return () => window.removeEventListener("command:capture", open);
  }, []);
  const [workRevision, setWorkRevision] = useState(0);
  const [recordId, setRecordId] = useState<string | null>(() =>
    new URLSearchParams(location.search).get("record"),
  );
  function openRecord(item: Pick<WorkItem, "id">) {
    setRecordId(item.id);
    history.replaceState(null, "", `/?record=${item.id}`);
  }
  function closeRecord() {
    setRecordId(null);
    history.replaceState(null, "", "/");
  }
  function navigate(next: "workspace" | "settings" | "lab" | Kind) {
    setMore(false);
    closeRecord();
    setPage(next);
    window.scrollTo({ top: 0 });
    requestAnimationFrame(() =>
      document.querySelector<HTMLElement>("#main h1")?.focus(),
    );
  }
  const [preferences, setPreferences] = useState<Preferences | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [reload, setReload] = useState(0);
  useEffect(() => {
    let alive = true;
    readPreferences(client, user.id)
      .then((value) => {
        if (alive) {
          setPreferences(value);
          setError("");
        }
      })
      .catch((caught) => {
        if (alive)
          setError(
            caught instanceof Error
              ? caught.message
              : "Unable to load preferences.",
          );
      });
    return () => {
      alive = false;
    };
  }, [client, user.id, reload]);
  useEffect(() => {
    const query = window.matchMedia("(prefers-color-scheme: dark)");
    const apply = () => {
      const theme =
        preferences?.theme === "system"
          ? query.matches
            ? "dark"
            : "light"
          : (preferences?.theme ?? "dark");
      document.documentElement.dataset.theme = theme;
      document
        .querySelector('meta[name="theme-color"]')
        ?.setAttribute("content", theme === "dark" ? "#161a1d" : "#f7f8fa");
    };
    apply();
    query.addEventListener("change", apply);
    return () => {
      query.removeEventListener("change", apply);
      delete document.documentElement.dataset.theme;
    };
  }, [preferences?.theme]);
  async function changeTheme(theme: Theme) {
    if (!preferences || busy) return;
    setBusy(true);
    setError("");
    setMessage("");
    try {
      setPreferences(await saveTheme(client, preferences, theme));
      setMessage("Appearance saved.");
    } catch (caught) {
      setError(
        caught instanceof Error ? caught.message : "Unable to save appearance.",
      );
    } finally {
      setBusy(false);
    }
  }
  async function logout() {
    try {
      const drafts = listDrafts(localStorage, user.id);
      if (drafts.length) {
        setError(
          "You have unsaved local drafts. Save them, or export and explicitly discard them in Settings before signing out.",
        );
        closeRecord();
        setPage("settings");
        return;
      }
    } catch {
      setError(
        "Draft storage could not be checked. Resolve local draft recovery before signing out.",
      );
      return;
    }
    setBusy(true);
    setError("");
    try {
      await signOut(client);
    } catch (caught) {
      setError(
        caught instanceof Error ? caught.message : "Unable to sign out.",
      );
      setBusy(false);
    }
  }
  useEffect(() => {
    const guard = (event: Event) => {
      try {
        if (listDrafts(localStorage, user.id).length) event.preventDefault();
      } catch {
        event.preventDefault();
      }
    };
    window.addEventListener("command:before-update", guard);
    return () => window.removeEventListener("command:before-update", guard);
  }, [user.id]);
  return (
    <div className="workspace app-shell">
      <a className="skip-link" href="#main">
        Skip to content
      </a>
      <aside className="sidebar">
        <div className="brand-lockup">
          <Mark />
          <div>
            <strong>COMMAND</strong>
            <small>FOCUS · ORGANIZE · EXPLORE · DO</small>
          </div>
        </div>
        <nav className="shell-nav" aria-label="Main navigation">
          {navigation.map((n, index) => (
            <div key={n.page}>
              {index > 0 && navigation[index - 1]?.group !== n.group && (
                <p className="nav-group">{n.group}</p>
              )}
              <button
                aria-current={page === n.page ? "page" : undefined}
                onClick={() => navigate(n.page)}
              >
                <Icon name={n.icon} />
                <span>{n.label}</span>
                {page === n.page && <span className="nav-active-dot" />}
              </button>
            </div>
          ))}
        </nav>
        <div className="sidebar-footer">
          <div className="orbit-landscape" aria-hidden="true">
            <i />
            <i />
            <i />
          </div>
          <p>
            A MORE FOCUSED YOU.
            <br />
            <strong>A BRIGHTER TOMORROW.</strong>
          </p>
          <span>YOUR PRIVATE WORKSPACE</span>
        </div>
      </aside>
      <header className="workspace-header">
        <div className="mobile-brand">
          <Mark />
          <span>COMMAND</span>
        </div>
        <button
          className="command-search"
          aria-label="Search Command"
          onClick={() => setPalette(true)}
        >
          <Icon name="search" />
          <span>Search or jump to anything…</span>
          <kbd>⌘ K</kbd>
        </button>
        <div className="header-date">
          <Icon name="clock" />
          <span>
            {new Intl.DateTimeFormat("en-US", {
              timeZone: "America/New_York",
              month: "short",
              day: "numeric",
            }).format(new Date())}
            <small>NEW YORK · ET</small>
          </span>
        </div>
        <button
          className="theme-switch icon-button"
          disabled={!preferences || busy}
          aria-label="Switch color theme"
          title="Switch color theme"
          onClick={() =>
            void changeTheme(
              document.documentElement.dataset.theme === "light"
                ? "dark"
                : "light",
            )
          }
        >
          <Icon name="sun" />
        </button>
        <button className="capture-button" onClick={() => setCapture(true)}>
          <Icon name="plus" />
          <span>Quick Capture</span>
        </button>
        <span className="user-avatar" aria-label="Kevin">
          K
        </span>
        <button
          className="signout-button"
          disabled={busy}
          onClick={() => void logout()}
        >
          Sign out
        </button>
      </header>
      <nav className="mobile-nav" aria-label="Main navigation">
        <button
          aria-current={page === "workspace" ? "page" : undefined}
          onClick={() => navigate("workspace")}
        >
          <Icon name="home" />
          <span>Work Day</span>
        </button>
        <button
          aria-current={page === "task" ? "page" : undefined}
          onClick={() => navigate("task")}
        >
          <Icon name="task" />
          <span>Tasks</span>
        </button>
        <button
          className="mobile-capture"
          aria-label="Capture a thought"
          onClick={() => setCapture(true)}
        >
          <Icon name="plus" />
          <span>Capture</span>
        </button>
        <button
          aria-current={page === "project" ? "page" : undefined}
          onClick={() => navigate("project")}
        >
          <Icon name="project" />
          <span>Projects</span>
        </button>
        <button aria-expanded={more} onClick={() => setMore(true)}>
          <Icon name="more" />
          <span>More</span>
        </button>
      </nav>
      {more && (
        <dialog
          ref={moreDialog}
          className="more-sheet"
          aria-label="Workspaces"
          onCancel={() => setMore(false)}
        >
          <div className="dialog-heading">
            <h2>Your workspaces</h2>
            <button
              aria-label="Close workspaces"
              onClick={() => setMore(false)}
            >
              <Icon name="close" />
            </button>
          </div>
          <div className="more-grid">
            {navigation
              .filter((n) => !["workspace", "task", "project"].includes(n.page))
              .map((n) => (
                <button key={n.page} onClick={() => navigate(n.page)}>
                  <Icon name={n.icon} />
                  {n.label}
                </button>
              ))}
            <button onClick={() => navigate("reminder")}>
              <Icon name="bell" />
              Reminders
            </button>
            <button onClick={() => navigate("waiting")}>
              <Icon name="clock" />
              Waiting On
            </button>
          </div>
        </dialog>
      )}
      <main id="main" className="workspace-content" tabIndex={-1}>
        {recordId ? (
          <Detail
            key={recordId}
            client={client}
            userId={user.id}
            id={recordId}
            onClose={closeRecord}
          />
        ) : page === "lab" ? (
          <Lab client={client} userId={user.id} onOpen={openRecord} />
        ) : page !== "workspace" && page !== "settings" ? (
          <WorkList
            key={page}
            client={client}
            userId={user.id}
            kind={page}
            onOpen={openRecord}
          />
        ) : (
          <>
            {page === "workspace" ? (
              <WorkDay
                client={client}
                revision={workRevision}
                onOpen={openRecord}
                onNavigate={navigate}
              />
            ) : (
              <>
                <p className="eyebrow">Make it yours</p>
                <h1 tabIndex={-1}>Settings</h1>
                <section
                  className="settings-panel"
                  aria-labelledby="appearance-title"
                >
                  <h2 id="appearance-title">Appearance</h2>
                  <p className="muted">
                    Choose a theme for your signed-in devices.
                  </p>
                  <label>
                    Appearance
                    <select
                      aria-label="Appearance"
                      value={preferences?.theme ?? "dark"}
                      disabled={!preferences || busy}
                      onChange={(event) =>
                        void changeTheme(event.target.value as Theme)
                      }
                    >
                      <option value="dark">Dark</option>
                      <option value="light">Light</option>
                      <option value="system">Use device setting</option>
                    </select>
                  </label>
                  <p className="muted small">Time zone · America/New_York</p>
                  <p className="notice" role="status">
                    {message}
                  </p>
                </section>
                <Drafts userId={user.id} />
                <section className="settings-panel">
                  <h2>Install Command</h2>
                  <p className="muted">
                    In Safari on iPad or iPhone, use Share → Add to Home Screen.
                    On desktop, use your browser’s install option.
                  </p>
                </section>
              </>
            )}
          </>
        )}
        {error && (
          <div role="alert" className="error-message">
            <p>{error}</p>
            <button
              type="button"
              disabled={busy}
              onClick={() => {
                setMessage("");
                setReload((value) => value + 1);
              }}
            >
              Reload preferences
            </button>
          </div>
        )}
      </main>
      {palette && (
        <Palette
          client={client}
          onNavigate={navigate}
          onOpen={openRecord}
          onCapture={() => setCapture(true)}
          onClose={() => setPalette(false)}
        />
      )}
      {capture && (
        <Capture
          client={client}
          userId={user.id}
          onClose={() => setCapture(false)}
          onSaved={() => {
            setCapture(false);
            setWorkRevision((v) => v + 1);
            navigate("journal");
          }}
        />
      )}
    </div>
  );
}
