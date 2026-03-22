import { config } from "../config.js";

const GROQ_FILLER_MODEL = "llama-3.3-70b-versatile";

const SYSTEM_PROMPT = `You are the inner voice of a friendly assistant named Claw. You narrate what the assistant is doing RIGHT NOW in 2-5 words max. Sound natural and human. Never answer the user's question. Never ask questions. Just narrate the action.

Examples of GOOD output:
- "Checking your files..."
- "Let me look..."
- "Searching for that..."
- "Yeah, got it!"
- "Looking into it..."

Examples of BAD output (too long):
- "I am now going to search through your files"
- "The answer is 42"`;

/**
 * Pre-written fillers for known tools (instant, no API call needed).
 * Each tool maps to an array of possible fillers — one is picked randomly.
 */
const INSTANT_FILLERS: Record<string, string[]> = {
  // Agent phases
  acknowledge: ["Let me check on that", "On it!", "Sure thing", "Got it, let me look", "Alright, one moment"],
  recall: ["Checking my memory", "Let me recall", "Searching my notes"],
  thinking: ["Thinking about this", "Processing that", "Let me figure this out"],

  // Common tools
  web_search: ["Searching the web", "Let me look that up", "Googling that"],
  remember: ["Saving that", "Noted!", "I'll remember that"],
  recall_memory: ["Checking my memory", "Let me recall"],
  list_directory: ["Checking your files", "Looking at the folder", "Scanning the directory"],
  read_file: ["Reading the file", "Let me open that", "Looking at the contents"],
  write_file: ["Writing to the file", "Saving changes", "Updating the file"],
  open_terminal: ["Opening terminal", "Firing up the shell"],
  terminal_run: ["Running a command", "Executing that", "Let me run this"],
  open_app: ["Opening that app", "Launching it now"],
  open_folder: ["Opening the folder"],
  get_daily_plan: ["Checking your plan", "Looking at today's schedule"],
  create_daily_plan: ["Setting up your plan", "Planning your day"],
  add_relations: ["Connecting the dots", "Linking those together"],
  query_graph: ["Searching the graph", "Checking connections"],
  search_files: ["Searching your files", "Looking for that"],
};

/**
 * Try to get an instant pre-written filler for a known tool.
 * Returns null for unknown tools (caller should fall back to Groq).
 */
export function getInstantFiller(toolName: string): string | null {
  const fillers = INSTANT_FILLERS[toolName];
  if (!fillers || fillers.length === 0) return null;
  return fillers[Math.floor(Math.random() * fillers.length)];
}

/**
 * Generates a per-tool-call filler via Groq (fallback for unknown tools).
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
