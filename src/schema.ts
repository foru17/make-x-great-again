import { z } from "zod";

/**
 * Provisional schemas for the local classifier spike.
 * Production data contract lives in `services/edge/schema.sql`.
 * The immutable key is the X numeric user id; @handle is mutable and never
 * used as a key.
 */

export const AccountSignals = z.object({
  /** X numeric user id — immutable, the blocklist key. */
  userId: z.string().regex(/^\d+$/, "userId must be the X numeric id"),
  /** @handle without the leading @ (mutable, informational only). */
  handle: z.string().min(1),
  displayName: z.string().default(""),
  bio: z.string().default(""),
  /** 5–10 most recent tweets/replies, newest first. */
  recentTweets: z.array(z.string()).max(20).default([]),
  /** The comment/reply that triggered review, if any. */
  triggeringComment: z.string().optional(),
  /** Root tweet of the thread — lets the model judge off-topic replies. */
  threadTopic: z.string().optional(),
  accountAgeDays: z.number().int().nonnegative().optional(),
  followersCount: z.number().int().nonnegative().optional(),
  followingCount: z.number().int().nonnegative().optional(),
  /** Default/empty profile picture — a strong bot signal on new accounts. */
  hasDefaultAvatar: z.boolean().optional(),
});
export type AccountSignals = z.infer<typeof AccountSignals>;

export const VerdictLabel = z.enum(["spam", "porn_bot", "likely_spam", "uncertain", "legit"]);
export type VerdictLabel = z.infer<typeof VerdictLabel>;

export const Verdict = z.object({
  label: VerdictLabel,
  /** 0..1 — model self-reported confidence in the label. */
  confidence: z.number().min(0).max(1),
  /** Short, concrete, evidence-grounded reasons. */
  reasons: z.array(z.string()).min(1).max(6),
});
export type Verdict = z.infer<typeof Verdict>;

/**
 * Append-only curation record. Governance red-line: an AI verdict is NEVER
 * auto-public. Everything lands as `auto_pending_review` until a human gate
 * or review pipeline promotes it. Status set is canonicalized in
 * docs/SPEC-T1.md §3.3 to match the deployed edge DB.
 */
export const ReviewStatus = z.enum([
  "auto_pending_review",
  "human_confirmed",
  "rejected",
  "removed",
]);
export type ReviewStatus = z.infer<typeof ReviewStatus>;

export const CurationRecord = z.object({
  userId: z.string(),
  handle: z.string(),
  /** sha256 of the canonicalized signals — lets us detect re-scores. */
  signalsHash: z.string(),
  verdict: Verdict,
  model: z.string(),
  reviewStatus: ReviewStatus,
  createdAt: z.string(), // ISO-8601
});
export type CurationRecord = z.infer<typeof CurationRecord>;
