import type { AIProvider } from "./types";
import z from "zod";

/** Effort levels a connection can ask for, lowest first. Ultra is passed through to servers that accept it. */
export const AI_REASONING_EFFORTS = ["minimal", "low", "medium", "high", "xhigh", "max", "ultra"] as const;
export type AiReasoningEffort = (typeof AI_REASONING_EFFORTS)[number];

/**
 * How much a connection's model reasons before it answers: "none" switches thinking off, an effort switches it on at
 * that level. Null is Model default: nothing is sent, and the model or server decides.
 */
export const aiReasoningSchema = z.enum(["none", ...AI_REASONING_EFFORTS]);
export type AiReasoning = z.infer<typeof aiReasoningSchema>;

/**
 * Providers whose requests can carry an effort the AI SDK doesn't list (Ultra), sent as-is as `reasoning_effort`. The
 * SDK translates every other level for each provider itself.
 */
export const acceptsCustomReasoning = (provider: AIProvider) =>
	provider === "openai-compatible" || provider === "openrouter";
