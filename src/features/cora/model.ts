import type { Kind, WorkInput } from "../work/model";
export type CoraContext = { page: string; recordId: string | null };
export type TaskProposal = {
  title: string;
  due_date: string | null;
  priority: "Critical" | "High" | "Normal" | "Low";
  project_id: string | null;
};
export type RecordProposal = {
  type: "record";
  kind: Kind;
  operation: "create" | "update" | "convert";
  record_id: string | null;
  expected_version: number | null;
  title: string;
  fields: Partial<WorkInput>;
};
export type CoraProposal = TaskProposal | RecordProposal;
export type CoraSource = {
  id: string;
  title: string;
  kind: string;
  url?: string;
};
export type CoraTurn = {
  id: string;
  user_id: string;
  conversation_id: string;
  message: string;
  context: CoraContext;
  response: string;
  sources: CoraSource[];
  proposal: CoraProposal | null;
  task_id: string;
  status: "running" | "complete" | "error";
  action_status: "none" | "proposed" | "created";
  created_at: string;
  finished_at: string | null;
};
export type CoraConversation = {
  id: string;
  user_id: string;
  title: string;
  created_at: string;
  updated_at: string;
};
export type CoraActivity = {
  id: string;
  user_id: string;
  turn_id: string;
  tool: string;
  arguments: Record<string, unknown>;
  result: Record<string, unknown>;
  success: boolean;
  created_at: string;
};
export type CoraEvent =
  | { type: "status"; message: string }
  | { type: "delta"; text: string }
  | { type: "complete"; turn: CoraTurn }
  | { type: "error"; message: string };
