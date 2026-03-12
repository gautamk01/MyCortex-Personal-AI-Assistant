import { Pinecone } from "@pinecone-database/pinecone";
import OpenAI from "openai";
import { config } from "../config.js";

// ── Singletons ─────────────────────────────────────────────────

let pineconeIndex: ReturnType<Pinecone["index"]> | null = null;
let openai: OpenAI | null = null;

/**
 * Initialize the Pinecone vector store + OpenAI embedder.
 * Call once during startup.
 */
export async function initSemanticMemory(): Promise<void> {
  if (!config.pineconeApiKey) {
    console.warn("⚠️  PINECONE_API_KEY not set — semantic memory disabled.");
    return;
  }

  const openaiKey = process.env.OPENAI_API_KEY;
  if (!openaiKey) {
    console.warn(
      "⚠️  OPENAI_API_KEY not set — semantic memory disabled (needed for embeddings)."
    );
    return;
  }

  try {
    // Initialize OpenAI client for embeddings
    openai = new OpenAI({ apiKey: openaiKey });

    // Initialize Pinecone client
    const pc = new Pinecone({ apiKey: config.pineconeApiKey });
    pineconeIndex = config.pineconeHost
      ? pc.index(config.pineconeIndexName, config.pineconeHost)
      : pc.index(config.pineconeIndexName);

    console.log("🧠 Semantic memory (Pinecone + OpenAI embeddings) initialized");
  } catch (err) {
    console.error("❌ Failed to initialize semantic memory:", err);
    pineconeIndex = null;
    openai = null;
  }
}

// ── Embedding ──────────────────────────────────────────────────

/**
 * Generate an embedding vector for the given text using OpenAI.
 */
async function embed(text: string): Promise<number[]> {
  if (!openai) throw new Error("OpenAI client not initialized");

  const response = await openai.embeddings.create({
    model: config.embeddingModel,
    input: text,
    dimensions: config.embeddingDims,
  });

  return response.data[0].embedding;
}

// ── Core Operations ────────────────────────────────────────────

/**
 * Store a conversation exchange as a vector in Pinecone.
 * The text is embedded and stored with metadata for later retrieval.
 */
export async function storeEpisode(
  chatId: number,
  userMessage: string,
  assistantMessage: string
): Promise<void> {
  if (!pineconeIndex || !openai) return;

  try {
    const combinedText = `User: ${userMessage}\nAssistant: ${assistantMessage}`;

    // Truncate if too long (embedding models have input limits)
    const truncated =
      combinedText.length > 8000 ? combinedText.slice(0, 8000) : combinedText;

    const vector = await embed(truncated);
    const id = `ep_${chatId}_${Date.now()}`;
    const namespace = pineconeIndex.namespace(`chat_${chatId}`);

    await namespace.upsert({
      records: [
        {
          id,
          values: vector,
          metadata: {
            chatId,
            userMessage:
              userMessage.length > 1000
                ? userMessage.slice(0, 1000)
                : userMessage,
            assistantMessage:
              assistantMessage.length > 1000
                ? assistantMessage.slice(0, 1000)
                : assistantMessage,
            timestamp: new Date().toISOString(),
          },
        },
      ],
    });
  } catch (err) {
    console.error("⚠️  Failed to store episode in Pinecone:", err);
  }
}

/**
 * Search Pinecone for the most semantically similar past conversations.
 */
export async function searchMemories(
  chatId: number,
  query: string,
  topK: number = 5
): Promise<
  Array<{
    userMessage: string;
    assistantMessage: string;
    score: number;
    timestamp: string;
  }>
> {
  if (!pineconeIndex || !openai) return [];

  try {
    const queryVector = await embed(query);
    const namespace = pineconeIndex.namespace(`chat_${chatId}`);

    const results = await namespace.query({
      vector: queryVector,
      topK,
      includeMetadata: true,
    });

    if (!results.matches) return [];

    return results.matches
      .filter((m) => m.metadata && m.score && m.score > 0.3) // relevance threshold
      .map((m) => ({
        userMessage: (m.metadata?.userMessage as string) || "",
        assistantMessage: (m.metadata?.assistantMessage as string) || "",
        score: m.score || 0,
        timestamp: (m.metadata?.timestamp as string) || "",
      }));
  } catch (err) {
    console.error("⚠️  Semantic memory search failed:", err);
    return [];
  }
}

/**
 * Get formatted semantic memory context for injection into the system prompt.
 */
export async function getSemanticContext(
  chatId: number,
  query: string
): Promise<string> {
  const memories = await searchMemories(chatId, query);

  if (memories.length === 0) return "";

  const lines = memories.map((m) => {
    const score = `${(m.score * 100).toFixed(0)}%`;
    return `- [${score}] User asked: "${m.userMessage.slice(0, 100)}${m.userMessage.length > 100 ? "…" : ""}" → You replied about: "${m.assistantMessage.slice(0, 120)}${m.assistantMessage.length > 120 ? "…" : ""}"`;
  });

  return `\n## Relevant Past Conversations (semantic search)\n${lines.join("\n")}`;
}

/**
 * Check if semantic memory is available.
 */
export function isSemanticMemoryEnabled(): boolean {
  return pineconeIndex !== null && openai !== null;
}
