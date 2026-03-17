import { config } from "../config.js";
import { chat, type ChatCompletionMessageParam } from "../llm.js";
import { storeFact } from "./sqlite.js";
import { addEntity, addRelation } from "./knowledge-graph.js";
import { setHeartbeatContextStatus, upsertHeartbeatContext } from "../coach.js";

// ── Types ──────────────────────────────────────────────────────

interface ExtractedData {
  facts: Array<{ key: string; value: string; category: string }>;
  entities: Array<{
    name: string;
    type: string;
    properties: Record<string, unknown>;
  }>;
  relations: Array<{
    from: string;
    to: string;
    relation: string;
  }>;
  heartbeatContexts: Array<{
    subject: string;
    status: "active" | "done" | "stale";
    source: "conversation";
    reason: string;
  }>;
}

// ── Extraction Prompt ──────────────────────────────────────────

const EXTRACTION_PROMPT = `You are a memory extraction engine. Analyze the conversation below and extract structured information.

Return a JSON object with these fields:
- "facts": Array of {key, value, category} — personal facts, preferences, goals, or important statements the user shared.
  - key: short snake_case identifier (e.g. "favorite_language", "current_project")
  - value: the actual value
  - category: one of "personal", "preference", "work", "project", "goal", "general"
- "entities": Array of {name, type, properties} — people, places, projects, tools, concepts mentioned.
  - type: one of "person", "place", "project", "tool", "concept", "organization", "thing"
- "relations": Array of {from, to, relation} — connections between entities.
  - relation: descriptive verb like "works_on", "uses", "knows", "prefers", "lives_in"
- "heartbeatContexts": Array of {subject, status, source, reason}
  - source: always "conversation"
  - status: "active" when the user is still working on / planning / worried about it soon, "done" when they clearly finished it, "stale" when they clearly switched away from it
  - subject: a short natural phrase like "resume edits", "DBMS revision", "calling the recruiter"
  - Only include topics that are worth asking about in the next few hours or later today

Rules:
- Only extract NEW, meaningful information. Skip greetings, filler, and obvious context.
- If nothing meaningful is found, return empty arrays.
- Keep values concise but complete.
- For heartbeat contexts, prefer current work, promised next actions, blockers, or things the user says they still need to finish.
- Do NOT invent information not present in the conversation.

Respond with ONLY valid JSON, no other text.`;

// ── Auto-Extract Function ──────────────────────────────────────

/**
 * Analyze a conversation exchange and automatically extract facts,
 * entities, and relations into the SQLite knowledge graph.
 *
 * Runs as a fire-and-forget background task after each agent loop.
 */
export async function autoExtract(
  chatId: number,
  userMessage: string,
  assistantMessage: string
): Promise<void> {
  try {
    const conversationSnippet = `User: ${userMessage}\nAssistant: ${assistantMessage}`;

    const messages: ChatCompletionMessageParam[] = [
      { role: "user", content: conversationSnippet },
    ];

    const response = await chat(EXTRACTION_PROMPT, messages, []);
    const content = response.choices[0]?.message?.content;

    if (!content) return;

    // Parse the JSON response — handle markdown code blocks
    let jsonStr = content.trim();
    if (jsonStr.startsWith("```")) {
      jsonStr = jsonStr.replace(/^```(?:json)?\n?/, "").replace(/\n?```$/, "");
    }

    let extracted: ExtractedData;
    try {
      extracted = JSON.parse(jsonStr);
    } catch {
      // LLM returned non-JSON — skip silently
      return;
    }

    // Store extracted facts
    if (extracted.facts && Array.isArray(extracted.facts)) {
      for (const fact of extracted.facts) {
        if (fact.key && fact.value) {
          const key = typeof fact.key === "string" ? fact.key : JSON.stringify(fact.key);
          const val = typeof fact.value === "string" ? fact.value : JSON.stringify(fact.value);
          const cat = typeof fact.category === "string" ? fact.category : (fact.category ? JSON.stringify(fact.category) : "general");
          storeFact(chatId, String(key), String(val), String(cat));
        }
      }
    }

    // Store extracted entities
    if (extracted.entities && Array.isArray(extracted.entities)) {
      for (const entity of extracted.entities) {
        if (entity.name) {
          const name = typeof entity.name === "string" ? entity.name : JSON.stringify(entity.name);
          const type = typeof entity.type === "string" ? entity.type : (entity.type ? JSON.stringify(entity.type) : "thing");
          addEntity(
            chatId,
            String(name),
            String(type),
            typeof entity.properties === "object" && entity.properties !== null ? entity.properties : {}
          );
        }
      }
    }

    // Store extracted relations
    if (extracted.relations && Array.isArray(extracted.relations)) {
      for (const rel of extracted.relations) {
        if (rel.from && rel.to && rel.relation) {
          const from = typeof rel.from === "string" ? rel.from : JSON.stringify(rel.from);
          const to = typeof rel.to === "string" ? rel.to : JSON.stringify(rel.to);
          const relation = typeof rel.relation === "string" ? rel.relation : JSON.stringify(rel.relation);
          addRelation(chatId, String(from), String(to), String(relation));
        }
      }
    }

    if (extracted.heartbeatContexts && Array.isArray(extracted.heartbeatContexts)) {
      for (const context of extracted.heartbeatContexts) {
        if (!context.subject || typeof context.subject !== "string") continue;
        const status = context.status === "done" || context.status === "stale"
          ? context.status
          : "active";

        if (status === "active") {
          upsertHeartbeatContext(
            chatId,
            "conversation",
            context.subject,
            "active",
            { reason: context.reason || "conversation", source: "conversation" },
          );
        } else {
          setHeartbeatContextStatus(chatId, context.subject, status);
        }
      }
    }

    const counts = {
      facts: extracted.facts?.length || 0,
      entities: extracted.entities?.length || 0,
      relations: extracted.relations?.length || 0,
      heartbeatContexts: extracted.heartbeatContexts?.length || 0,
    };

    if (counts.facts + counts.entities + counts.relations + counts.heartbeatContexts > 0) {
      console.log(
        `🧠 Auto-extracted: ${counts.facts} facts, ${counts.entities} entities, ${counts.relations} relations, ${counts.heartbeatContexts} heartbeat contexts`
      );
    }
  } catch (err) {
    // Non-critical — don't crash the agent loop
    console.error("⚠️  Auto-extraction failed:", err);
  }
}
