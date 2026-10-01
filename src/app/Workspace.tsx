import { Directory } from "../features/people/Directory";
import {WorkdayReviews} from "../features/reviews/WorkdayReviews";
import { lazy, Suspense, useEffect, useState, useRef } from "react";
import type { User } from "@supabase/supabase-js";
import type { AppClient } from "../platform/supabase";
import { readPreferences, saveTheme } from "../services/account";
import type { Preferences } from "../services/account";
import { signOut } from "../services/auth";
import { Editor } from "../features/work/Editor";
import { Detail } from "../features/work/Detail";
import type { Kind, WorkItem } from "../features/work/model";
import { Icon, Mark } from "../ui/Icon";
import { currentMode, fromStoredTheme, hasLocalMode, setMode, themeModes, toStoredTheme } from "../ui/theme";
import type { ThemeMode } from "../ui/theme";
import { navigation } from "../ui/navigation";
import { Palette } from "../ui/Palette";
import { WorkList } from "../features/work/WorkList";
import { WorkDay } from "../features/work/WorkDay";
import { Capture } from "../features/work/Capture";
import { ExportPanel } from '../features/export/ExportPanel';
import { Drafts } from "../features/work/Drafts";
import { Lab } from "../features/lab/Lab";
import { listDrafts } from "../platform/drafts";

const CoraPanel=lazy(()=>import("../features/cora/CoraPanel").then(m=>({default:m.CoraPanel})))
const CoraConnection=lazy(()=>import("../features/mcp/CoraConnection").then(m=>({default:m.CoraConnection})))
const HelixPanel=lazy(()=>import("../features/helix/HelixPanel").then(m=>({default:m.HelixPanel})))
const HelixWork=lazy(()=>import("../features/helix/HelixWork").then(m=>({default:m.HelixWork})))
const ConnectionPanel=lazy(()=>import("../features/microsoft/ConnectionPanel").then(m=>({default:m.ConnectionPanel})))

const railPages: string[] = ["workspace", "task", "project", "journal", "person", "library"];
const clockTime = () =>
  new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", hour: "numeric", minute: "2-digit" }).format(new Date());
function EasternClock() {
  const [time, setTime] = useState(clockTime);
  useEffect(() => {
    const timer = setInterval(() => setTime(clockTime()), 15000);
    return () => clearInterval(timer);
  }, []);
  return <>{time} <span>ET</span></>;
}

export function Workspace({ client, user }: { client: AppClient; user: User }) {
  const [page, setPage] = useState<"workspace" | "settings" | "lab" | Kind>(
    () => {
      const requested = new URLSearchParams(location.search).get("page");
      return [...navigation.map(item => item.page), "reminder", "waiting"].includes(requested ?? "") ? requested as "workspace" | "settings" | "lab" | Kind : "workspace";
    },
  );
  const [initialConversation] = useState(() => {
    const value = new URLSearchParams(location.search).get('coraConversation');
    return value && /^[a-f0-9]{8}(-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(value) ? value : undefined;
  });
  const [coraDirty,setCoraDirty]=useState(false);
  const [cora,setCora]=useState(!!initialConversation),[coraLoaded,setCoraLoaded]=useState(!!initialConversation),[coraPrompt,setCoraPrompt]=useState('');
  const openCora=(prompt='')=>{setCoraLoaded(true);setCora(true);if(prompt)setCoraPrompt(prompt)};
  const [capture, setCapture] = useState(false);
  const [newRecord, setNewRecord] = useState<"task" | "reminder" | null>(null);
  const [palette, setPalette] = useState(false),
    [more, setMore] = useState(false);
  const moreDialog = useRef<HTMLDialogElement>(null),
    avatarMenu = useRef<HTMLDetailsElement>(null);
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
    const ask = (event:Event) => {setCoraLoaded(true);setCora(true);setCoraPrompt((event as CustomEvent<string>).detail??'')};
    window.addEventListener("command:cora",ask);
    window.addEventListener("command:capture", open);
    return () => {window.removeEventListener("command:capture", open);window.removeEventListener("command:cora",ask)};
  }, []);
  const [workRevision, setWorkRevision] = useState(0);
  const [recordId, setRecordId] = useState<string | null>(() =>
    new URLSearchParams(location.search).get("record"),
  );
  function openRecord(item: Pick<WorkItem, "id">) {
    setRecordId(item.id);
    history.replaceState(null, "", `/?page=${page}&record=${item.id}`);
  }
  function closeRecord() {
    setRecordId(null);
    history.replaceState(null, "", page === "workspace" ? "/" : `/?page=${page}`);
  }
  function navigate(next: "workspace" | "settings" | "lab" | Kind) {
    setMore(false);
    closeRecord();
    setPage(next);
    history.replaceState(null, "", next === "workspace" ? "/" : `/?page=${next}`);
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
  const [mode, setModeState] = useState<ThemeMode>(currentMode);
  useEffect(() => {
    // A device with no local choice follows the saved preference: Day carries over, everything else is Auto.
    if (preferences && !hasLocalMode()) setMode(fromStoredTheme(preferences.theme));
  }, [preferences]);
  useEffect(() => {
    const sync = () => setModeState(currentMode());
    window.addEventListener("cmd-modechange", sync);
    return () => window.removeEventListener("cmd-modechange", sync);
  }, []);
  async function changeTheme(next: ThemeMode) {
    setMode(next);
    if (!preferences || busy) return;
    setBusy(true);
    setError("");
    setMessage("");
    try {
      setPreferences(await saveTheme(client, preferences, toStoredTheme(next)));
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
    avatarMenu.current?.removeAttribute("open");
    if(coraDirty){setError("Finish or clear your CMD draft before signing out.");openCora();return}
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
  return (
    <div className={cora?"workspace app-shell cora-open":"workspace app-shell"}>
      <a className="skip-link" href="#main">
        Skip to content
      </a>
      <nav className="rail" aria-label="Main navigation">
        <span className="rail-logo" aria-hidden="true">
          <Mark />
        </span>
        {navigation
          .filter((n) => railPages.includes(n.page))
          .map((n) => (
            <button
              key={n.page}
              className="rail-item"
              data-tip={n.label}
              aria-label={n.label}
              aria-current={page === n.page ? "page" : undefined}
              onClick={() => navigate(n.page)}
            >
              <Icon name={n.icon} />
            </button>
          ))}
        <button className="rail-item" data-tip="More" aria-label="More" aria-expanded={more} onClick={() => setMore(true)}>
          <Icon name="more" />
        </button>
        <span className="rail-spacer" />
        <button
          className="rail-item"
          data-tip="Settings"
          aria-label="Settings"
          aria-current={page === "settings" ? "page" : undefined}
          onClick={() => navigate("settings")}
        >
          <Icon name="settings" />
        </button>
        <details className="avatar-menu" ref={avatarMenu}>
          <summary aria-label="Account menu">K</summary>
          <div className="menu-panel">
            <p className="meta">{user.email}</p>
            <button className="btn btn--ghost" disabled={busy} onClick={() => void logout()}>
              Sign out
            </button>
          </div>
        </details>
      </nav>
      <header className="workspace-header">
        <div className="mobile-brand">
          <Mark />
          <span>COMMAND</span>
        </div>
        <span className="brand-word">COMMAND</span>
        <button
          className="command-field"
          aria-label="Capture, search, or ask CMD"
          onClick={() => setPalette(true)}
        >
          <span>Capture, search, or ask CMD…</span>
          <kbd>⌘K</kbd>
        </button>
        <div className="header-clock meta">
          <EasternClock />
        </div>
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
        <button aria-label="Search or ask CMD" onClick={() => setPalette(true)}>
          <Icon name="search" />
          <span>CMD</span>
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
            <h2>More</h2>
            <button
              aria-label="Close workspaces"
              onClick={() => setMore(false)}
            >
              <Icon name="close" />
            </button>
          </div>
          <div className="more-grid">
            <button onClick={()=>{setMore(false);setCapture(true)}}>Quick capture</button>
            {navigation
              .filter((n) => !railPages.includes(n.page) && n.page !== "settings")
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
            {navigation
              .filter((n) => railPages.includes(n.page) && !["workspace", "task", "project"].includes(n.page))
              .map((n) => (
                <button key={n.page} className="more-mobile-only" onClick={() => navigate(n.page)}>
                  <Icon name={n.icon} />
                  {n.label}
                </button>
              ))}
            <button className="more-mobile-only" onClick={() => navigate("settings")}>
              <Icon name="settings" />
              Settings
            </button>
            <button className="more-mobile-only" disabled={busy} onClick={() => void logout()}>
              Sign out
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
        ) : page === "person" ? (
          <Directory client={client} userId={user.id} onOpen={openRecord} revision={workRevision}/>
        ) : page === "lab" ? (
          <Lab client={client} userId={user.id} onOpen={openRecord} />
        ) : page !== "workspace" && page !== "settings" ? (
          <WorkList
            key={`${page}-${workRevision}`}
            client={client}
            userId={user.id}
            kind={page}
            onOpen={openRecord}
          />
        ) : (
          <>
            {page === "workspace" ? (
              <>
                <WorkDay
                  userId={user.id}
                  client={client}
                  revision={workRevision}
                  onOpen={openRecord}
                  onNavigate={navigate}
                />
                <Suspense fallback={null}><HelixWork client={client} /></Suspense>
              </>
            ) : (
              <>
                <h1 tabIndex={-1}>Settings</h1>
                <section
                  className="settings-panel"
                  aria-labelledby="appearance-title"
                >
                  <h2 id="appearance-title" className="label">Appearance</h2>
                  <p className="muted">
                    Auto switches to Evening from 6:00 PM to 6:30 AM Eastern.
                  </p>
                  <div className="segmented" role="group" aria-label="Appearance">
                    {themeModes.map((m) => (
                      <button
                        key={m.mode}
                        aria-pressed={mode === m.mode}
                        onClick={() => void changeTheme(m.mode)}
                      >
                        {m.label}
                      </button>
                    ))}
                  </div>
                  <p className="muted small">Time zone · America/New_York</p>
                  <p className="notice" role="status">
                    {message}
                  </p>
                </section>
                <Suspense fallback={<p role="status">Loading connections…</p>}><ConnectionPanel client={client} /></Suspense>
                <Suspense fallback={<p role="status">Loading Helix…</p>}><HelixPanel client={client} /></Suspense>
                <Suspense fallback={<p role="status">Loading connected apps…</p>}><CoraConnection client={client}/></Suspense>
                <WorkdayReviews client={client} settings/>
                <ExportPanel client={client} />
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
      {coraLoaded&&<Suspense fallback={null}><CoraPanel initialConversation={initialConversation} client={client} open={cora} onDirty={setCoraDirty} context={{page,recordId}} prompt={coraPrompt} onClose={()=>setCora(false)} onOpen={openRecord} onCreated={()=>setWorkRevision(v=>v+1)}/></Suspense>}
      {palette && (
        <Palette
          client={client}
          onNavigate={navigate}
          onOpen={openRecord}
          onCapture={() => setCapture(true)}
          onNewRecord={setNewRecord}
          onAsk={(prompt) => openCora(prompt)}
          onClose={() => setPalette(false)}
        />
      )}
      {newRecord && <Editor client={client} userId={user.id} kind={newRecord} onClose={() => setNewRecord(null)} onSaved={() => { setNewRecord(null); setWorkRevision(v => v + 1); }} />}
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
