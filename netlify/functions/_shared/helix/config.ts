export type HelixConfig = {
  supabaseUrl: string;
  clientId: string;
  clientSecret: string;
  encryptionKey: string;
  origin: string;
};
/** Must match the OAuth allowlist row in Helix (helix_ai_private.oauth_clients). */
export const helixResource =
  "https://helix.hillspafl.gov/api/bridge/v1/command-summary";
const guid = /^[a-f0-9]{8}(-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i;
export function helixConfig(
  env: (name: string) => string | undefined,
): HelixConfig | undefined {
  const supabaseUrl = env("HELIX_SUPABASE_URL"),
    clientId = env("HELIX_OAUTH_CLIENT_ID"),
    clientSecret = env("HELIX_OAUTH_CLIENT_SECRET"),
    encryptionKey = env("HELIX_TOKEN_ENCRYPTION_KEY"),
    origin = env("MICROSOFT_APP_ORIGIN") ?? "https://cmd.hillspafl.gov";
  if (!supabaseUrl || !clientId || !clientSecret || !encryptionKey) return;
  if (
    !/^https:\/\/[a-z0-9-]+\.supabase\.co$/.test(supabaseUrl) ||
    !guid.test(clientId) ||
    !/^[a-f0-9]{64}$/i.test(encryptionKey)
  )
    return;
  if (
    origin !== "https://cmd.hillspafl.gov" &&
    !(env("CONTEXT") === "dev" && origin === "http://127.0.0.1:8888")
  )
    return;
  return { supabaseUrl, clientId, clientSecret, encryptionKey, origin };
}
export const authorizeUrl = (c: HelixConfig) =>
  `${c.supabaseUrl}/auth/v1/oauth/authorize`;
export const tokenUrl = (c: HelixConfig) =>
  `${c.supabaseUrl}/auth/v1/oauth/token`;
