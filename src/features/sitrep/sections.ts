// Kept free of zod so the browser bundle can render sections without the validator.
export const sections = [
  ["now", "Now"],
  ["next", "Next"],
  ["prep", "Before you walk in"],
  ["owed_by_me", "Owed by you"],
  ["owed_to_me", "Owed to you"],
  ["coming_up", "Coming up"],
  ["watch", "Watch"],
] as const;
