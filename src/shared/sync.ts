import type { Grade } from "../store/srs";
import type { Progress, Settings, TypingRound } from "./model";

export const ACCOUNT_FIELDS = [
  "accent",
  "dailyNew",
  "retention",
  "spell",
  "startLevel",
  "onboarded",
] as const;
export interface Account {
  id: string;
  username: string;
  timezone: string;
}
export interface Snapshot {
  userId: string;
  progress: Progress;
  settings: Settings;
  revision: number;
  epoch: number;
  updatedAt: number;
}
export type Action =
  | { type: "review"; wordId: string; grade: Grade; sessionId: string }
  | { type: "advance"; sessionId: string; stepIndex: number; seconds: number }
  | { type: "bookmark"; wordId: string; saved: boolean }
  | { type: "typing"; roundId: string; round: TypingRound }
  | { type: "settings"; patch: Partial<Settings> }
  | { type: "import"; backup: unknown }
  | { type: "save"; backup: unknown }
  | { type: "reset" };
export interface Mutation {
  userId: string;
  operationId: string;
  datasetId: string;
  baseRevision: number;
  epoch: number;
  action: Action;
}
