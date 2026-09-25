import Anthropic from "@anthropic-ai/sdk";
import { identity } from "./identity";

export type Effort = "low" | "medium" | "high" | "xhigh" | "max";
export type ProviderConfig = {
  apiKey: string;
  baseURL?: string;
  model?: string;
  effort?: string;
};
const efforts: Effort[] = ["low", "medium", "high", "xhigh", "max"];

export function createProvider(config: ProviderConfig, timeout = 40000) {
  // Retries are disabled: every Cora request already has a hard deadline and
  // a retry could repeat a tool round the user already saw stream.
  return new Anthropic({
    apiKey: config.apiKey,
    baseURL: config.baseURL,
    maxRetries: 0,
    timeout,
  });
}

export function modelSettings(config: ProviderConfig, fallbackEffort: Effort) {
  const effort = efforts.includes(config.effort as Effort)
    ? (config.effort as Effort)
    : fallbackEffort;
  const model = config.model ?? identity.model;
  // Server-side refusal fallbacks are a first-party Claude API feature. A proxy
  // such as Netlify AI Gateway may not forward the beta, so only send it direct.
  const direct =
    !config.baseURL || new URL(config.baseURL).hostname === "api.anthropic.com";
  return {
    model,
    output_config: { effort },
    ...(direct
      ? {
          betas: ["server-side-fallback-2026-07-01"],
          fallbacks: "default" as const,
        }
      : {}),
  };
}
