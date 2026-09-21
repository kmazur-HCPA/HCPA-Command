export type MicrosoftConfig = {
  tenantId: string;
  clientId: string;
  clientSecret: string;
  encryptionKey: string;
  origin: string;
};
export const scopes = ["User.Read", "Calendars.Read", "Mail.Read"];
export const teamsScopes = ["Chat.Read", "ChannelMessage.Read.All"];
export const consentScopes = [...scopes, ...teamsScopes];
export const normalizedScope = (scope: string) =>
  scope.toLowerCase().replace(/^https:\/\/graph\.microsoft\.com\//, "");
export const hasTeamsConsent = (granted: string[] = []) =>
  teamsScopes.every((scope) =>
    granted.map(normalizedScope).includes(normalizedScope(scope)),
  );
const guid = /^[a-f0-9]{8}(-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i;
export function microsoftConfig(
  env: (name: string) => string | undefined,
): MicrosoftConfig | undefined {
  const tenantId = env("MICROSOFT_TENANT_ID"),
    clientId = env("MICROSOFT_CLIENT_ID"),
    clientSecret = env("MICROSOFT_CLIENT_SECRET"),
    encryptionKey = env("MICROSOFT_TOKEN_ENCRYPTION_KEY"),
    origin = env("MICROSOFT_APP_ORIGIN") ?? "https://cmd.hillspafl.gov";
  if (!tenantId || !clientId || !clientSecret || !encryptionKey) return;
  if (
    !guid.test(tenantId) ||
    !guid.test(clientId) ||
    !/^[a-f0-9]{64}$/i.test(encryptionKey)
  )
    return;
  if (
    origin !== "https://cmd.hillspafl.gov" &&
    !(env("CONTEXT") === "dev" && origin === "http://127.0.0.1:8888")
  )
    return;
  return { tenantId, clientId, clientSecret, encryptionKey, origin };
}
