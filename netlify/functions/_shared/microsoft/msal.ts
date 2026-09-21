import {
  ConfidentialClientApplication,
  type NetworkRequestOptions,
} from "@azure/msal-node";
import type { MicrosoftConfig } from "./config";
export async function boundedResponse(response: Response, maximum = 750000) {
  const reader = response.body?.getReader();
  if (!reader) throw new Error("Microsoft returned an empty response.");
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const part = await reader.read();
    if (part.done) break;
    size += part.value.length;
    if (size > maximum) {
      await reader.cancel();
      throw new Error("Microsoft response too large. Narrow the request.");
    }
    chunks.push(part.value);
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}
export function microsoftApp(config: MicrosoftConfig, signal: AbortSignal) {
  async function send<T>(
    url: string,
    method: string,
    options?: NetworkRequestOptions,
  ) {
    const target = new URL(url);
    if (
      target.protocol !== "https:" ||
      target.hostname !== "login.microsoftonline.com" ||
      target.port ||
      target.username ||
      target.password
    )
      throw new Error("Invalid Microsoft authority.");
    const response = await fetch(target, {
      method,
      headers: options?.headers,
      body: options?.body,
      redirect: "error",
      signal: AbortSignal.any([signal, AbortSignal.timeout(8000)]),
    });
    return {
      headers: Object.fromEntries(response.headers),
      status: response.status,
      body: (await boundedResponse(response)) as T,
    };
  }
  return new ConfidentialClientApplication({
    auth: {
      clientId: config.clientId,
      authority: `https://login.microsoftonline.com/${config.tenantId}`,
      clientSecret: config.clientSecret,
    },
    system: {
      disableInternalRetries: true,
      loggerOptions: { piiLoggingEnabled: false, loggerCallback: () => {} },
      networkClient: {
        sendGetRequestAsync: <T>(
          url: string,
          options?: NetworkRequestOptions,
        ) => send<T>(url, "GET", options),
        sendPostRequestAsync: <T>(
          url: string,
          options?: NetworkRequestOptions,
        ) => send<T>(url, "POST", options),
      },
    },
  });
}
