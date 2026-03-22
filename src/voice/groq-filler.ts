import { config } from "../config.js";

const GROQ_FILLER_MODEL = "llama-3.3-70b-versatile";

const SYSTEM_PROMPT = `You are the inner voice of a friendly assistant named Claw. You narrate what the assistant is doing RIGHT NOW in 2-5 words max. Sound natural and human. Never answer the user's question. Never ask questions. Just narrate the action.

Examples of GOOD output:
- "Checking your files..."
- "Let me look..."
- "Searching for that..."
- "Yeah, got it!"
- "Here's what I found"
- "Looking into it..."
- "Crunching the numbers..."

Examples of BAD output (too long, answering the question, asking questions):
- "I am now going to search through your files to find the answer to your question"
- "The answer is 42"
- "What do you mean by that?"`;

/**
 * Generates a per-tool-call filler based on the user's prompt and the tool being invoked.
 */
export async function generateToolFiller(
  userPrompt: string,
  toolName: string,
  toolArgs: string,
): Promise<string | null> {
  if (!config.groqApiKey) return null;

  try {
    const response = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${config.groqApiKey}`,
      },
      body: JSON.stringify({
        model: GROQ_FILLER_MODEL,
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          {
            role: "user",
            content: toolName === "acknowledge"
              ? `User just said: "${userPrompt}"\nAcknowledge what they said in 2-5 words before processing:`
              : `User asked: "${userPrompt}"\nAssistant is now calling tool: ${toolName}(${toolArgs})\nNarrate this action in 2-5 words:`,
          },
        ],
        temperature: 0.8,
        max_tokens: 12,
      }),
    });

    if (!response.ok) {
      console.warn(`⚠️ Groq filler API: ${response.status}`);
      return null;
    }

    const data = await response.json();
    const filler = data.choices?.[0]?.message?.content?.trim();
    return filler ? filler.replace(/^["']|["']$/g, "").replace(/\n/g, " ").slice(0, 40) : null;
  } catch (err) {
    console.error("❌ Groq filler error:", err);
    return null;
  }
}

/**
 * Generates a short result-acknowledgment filler.
 */
export async function generateResultFiller(
  userPrompt: string,
  toolName: string,
  resultSnippet: string,
): Promise<string | null> {
  if (!config.groqApiKey) return null;

  try {
    const response = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${config.groqApiKey}`,
      },
      body: JSON.stringify({
        model: GROQ_FILLER_MODEL,
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          {
            role: "user",
            content: `User asked: "${userPrompt}"\nAssistant just got a result from tool ${toolName}: "${resultSnippet.slice(0, 60)}"\nAcknowledge the result in 2-3 words:`,
          },
        ],
        temperature: 0.8,
        max_tokens: 8,
      }),
    });

    if (!response.ok) return null;

    const data = await response.json();
    const filler = data.choices?.[0]?.message?.content?.trim();
    return filler ? filler.replace(/^["']|["']$/g, "").replace(/\n/g, " ").slice(0, 30) : null;
  } catch {
    return null;
  }
}
