// How Wye's hits read in the answer prompt: dated passages of the conversation, best first. The answer prompt is
// MemoryBench's default one with the context as text instead of raw JSON; a benchmark with its own answer prompt
// (LoCoMo: Mem0's, verbatim) only takes formatContext.
import type { ProviderPrompts } from "../../types/prompts"

export interface WyeHit { content: string; sessionId: string; date?: string; score: number; ref: string }

export function formatWyeContext(context: unknown[]): string {
  const hits = context as WyeHit[]
  if (!hits.length) return "No passages were retrieved."
  return hits.map((h, i) => `[${i + 1}] session ${h.sessionId}${h.date ? ` · ${h.date}` : ""}\n${h.content}`).join("\n\n---\n\n")
}

export function wyeAnswerPrompt(question: string, context: unknown[], questionDate?: string): string {
  return `You are a question-answering system. Based on the retrieved context below, answer the question.

Question: ${question}
Question Date: ${questionDate || "Not specified"}

Retrieved Context (passages of past conversations, most relevant first, each with its session and date):
${formatWyeContext(context)}

Instructions:
- Consider any temporal/date information present in the passages
- If the context contains enough information, provide a clear, concise answer
- If the context does not contain enough information, respond with "I don't know"
- Base your answer ONLY on the provided context

Answer:`
}

export const WYE_PROMPTS: ProviderPrompts = { formatContext: formatWyeContext, answerPrompt: wyeAnswerPrompt }
export default WYE_PROMPTS
