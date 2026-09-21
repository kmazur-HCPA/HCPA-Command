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
  revision: number;
  updated_at: string;
};
export type MicrosoftStatus = {
  configured: boolean;
  connected: boolean;
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
