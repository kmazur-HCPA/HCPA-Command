export type MicrosoftConnection = {
  user_id: string;
  generation: string;
  auth_state: string | null;
  browser_hash: string | null;
  verifier: string | null;
  auth_expires_at: string | null;
  token_cache: string | null;
  account_id: string | null;
  account_email: string | null;
  connected_at: string | null;
  granted_scopes: string[];
  revision: number;
  updated_at: string;
};
export type MicrosoftStatus = {
  configured: boolean;
  connected: boolean;
  teamsConnected?: boolean;
  email?: string;
  connectedAt?: string;
};
export function outlookLink(value: unknown): string | undefined {
  if (typeof value !== "string" || value.length > 4000) return;
  try {
    const url = new URL(value);
    if (
      url.protocol === "https:" &&
      ["outlook.office.com", "outlook.office365.com"].includes(url.hostname) &&
      !url.username &&
      !url.password &&
      !url.port
    )
      return url.href;
  } catch {
    /* Invalid external source URLs are never rendered. */
  }
}

export function teamsLink(value: unknown): string | undefined {
  if (typeof value !== "string" || value.length > 4000) return;
  try {
    const url = new URL(value);
    if (
      url.protocol === "https:" &&
      ["teams.microsoft.com", "teams.cloud.microsoft"].includes(url.hostname) &&
      !url.username &&
      !url.password &&
      !url.port &&
      url.pathname.startsWith("/l/")
    )
      return url.href;
  } catch {
    /* Untrusted URLs are never rendered. */
  }
}
export function microsoftSourceLink(kind: string, value: unknown) {
  return kind.startsWith("teams_")
    ? (teamsLink(value) ?? outlookLink(value))
    : outlookLink(value);
}
