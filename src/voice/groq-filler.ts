import { config } from "../config.js";

const GROQ_FILLER_MODEL = "llama-3.3-70b-versatile";
const GROQ_FAST_MODEL = "llama-3.1-8b-instant";

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

/**
 * Generates a continuous "thinking out loud" script of 3-5 sentences
 * related to the user's prompt. This fills the long wait periods.
 */
export async function generateThinkingOutLoud(
  userPrompt: string,
  previousThoughts: string = "",
): Promise<string[]> {
  if (!config.groqApiKey) return [];

  const contextStr = previousThoughts 
    ? `You already said: "${previousThoughts}". Give me MORE thoughts to keep stalling.`
    : `Give me the FIRST thoughts to stall.`;

  const system = `You are the inner voice of an AI assistant named Claw.
The user just asked you a question. Your backend is processing it, which takes a few seconds.
You need to generate 3 to 5 short stalling phrases that explicitly narrate that you are thinking about or working on their specific request.

Examples of GOOD output:
- "Wait a second, let me think about how to sort that array..."
- "I'm looking into the Python script for that right now..."
- "Let me check my memory for the details..."
- "This might take a moment to pull together..."
- "Just working on that for you..."

Rules:
- Do NOT answer their query.
- Make it sound like you are actively working on it RIGHT NOW.
- Keep each sentence under 12 words.
- ONLY output the sentences. Separate each sentence with a newline character. No markdown. No quotes.

${contextStr}`;

  try {
    const response = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${config.groqApiKey}`,
      },
      body: JSON.stringify({
        model: GROQ_FAST_MODEL, // Use 8B for maximum speed (~200ms)
        messages: [
          { role: "system", content: system },
          { role: "user", content: `User Prompt: "${userPrompt}"\n\nGenerate the stalling musings:` },
        ],
        temperature: 0.8,
        max_tokens: 150,
      }),
    });

    if (!response.ok) {
      const errBody = await response.text();
      console.error(`Groq API Error (${response.status}):`, errBody);
      return [];
    }

    const data = await response.json();
    const text = data.choices?.[0]?.message?.content?.trim() || "";
    if (!text) {
      console.error("Groq returned empty content:", data);
      return [];
    }
    
    // Split by newline and filter out empty strings
    return text.split("\n")
               .map((s: string) => s.trim().replace(/^[-*•]\s*/, '')) // Remove bullets if LLM messed up
               .filter((s: string) => s.length > 2);
  } catch (err) {
    console.error("Groq Musing generation failed:", err);
    return [];
  }
}
