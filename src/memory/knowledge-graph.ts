import { getDb } from "./sqlite.js";
import { registerTool } from "../tools/index.js";

// ── Entity Operations ──────────────────────────────────────────

export function addEntity(
  chatId: number,
  name: string,
  type: string = "thing",
  properties: Record<string, unknown> = {}
): string {
  const stmt = getDb().prepare(`
    INSERT INTO entities (chatId, name, type, properties, updatedAt)
    VALUES (?, ?, ?, ?, datetime('now'))
    ON CONFLICT(chatId, name) DO UPDATE SET
      type = excluded.type,
      properties = excluded.properties,
      updatedAt = datetime('now')
  `);
  stmt.run(chatId, name.toLowerCase(), type, JSON.stringify(properties));
  return `Entity stored: "${name}" (${type})`;
}

export function addRelation(
  chatId: number,
  fromEntity: string,
  toEntity: string,
  relationType: string,
  properties: Record<string, unknown> = {}
): string {
  // Ensure both entities exist (auto-create if missing)
  const ensureEntity = getDb().prepare(`
    INSERT OR IGNORE INTO entities (chatId, name) VALUES (?, ?)
  `);
  ensureEntity.run(chatId, fromEntity.toLowerCase());
  ensureEntity.run(chatId, toEntity.toLowerCase());

  const stmt = getDb().prepare(`
    INSERT INTO relations (chatId, fromEntity, toEntity, relationType, properties)
    VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(chatId, fromEntity, toEntity, relationType) DO UPDATE SET
      properties = excluded.properties
  `);
  stmt.run(
    chatId,
    fromEntity.toLowerCase(),
    toEntity.toLowerCase(),
    relationType,
    JSON.stringify(properties)
  );
  return `Relation stored: "${fromEntity}" --[${relationType}]--> "${toEntity}"`;
}

export function queryGraph(chatId: number, entityName: string): string {
  const name = entityName.toLowerCase();

  // Get the entity
  const entity = getDb()
    .prepare("SELECT * FROM entities WHERE chatId = ? AND name = ?")
    .get(chatId, name) as
    | { name: string; type: string; properties: string }
    | undefined;

  if (!entity) return `No entity found: "${entityName}"`;

  // Get all relations from/to this entity
  const outgoing = getDb()
    .prepare(
      "SELECT toEntity, relationType, properties FROM relations WHERE chatId = ? AND fromEntity = ?"
    )
    .all(chatId, name) as Array<{
    toEntity: string;
    relationType: string;
    properties: string;
  }>;

  const incoming = getDb()
    .prepare(
      "SELECT fromEntity, relationType, properties FROM relations WHERE chatId = ? AND toEntity = ?"
    )
    .all(chatId, name) as Array<{
    fromEntity: string;
    relationType: string;
    properties: string;
  }>;

  const lines: string[] = [
    `Entity: ${entity.name} (${entity.type})`,
    `Properties: ${entity.properties}`,
  ];

  if (outgoing.length > 0) {
    lines.push("Outgoing relations:");
    for (const r of outgoing) {
      lines.push(`  → [${r.relationType}] → ${r.toEntity}`);
    }
  }

  if (incoming.length > 0) {
    lines.push("Incoming relations:");
    for (const r of incoming) {
      lines.push(`  ← [${r.relationType}] ← ${r.fromEntity}`);
    }
  }

  return lines.join("\n");
}

export function searchGraph(chatId: number, query: string): string {
  const pattern = `%${query}%`;

  const entities = getDb()
    .prepare(
      "SELECT name, type FROM entities WHERE chatId = ? AND (name LIKE ? OR type LIKE ? OR properties LIKE ?) LIMIT 15"
    )
    .all(chatId, pattern, pattern, pattern) as Array<{
    name: string;
    type: string;
  }>;

  const relations = getDb()
    .prepare(
      "SELECT fromEntity, toEntity, relationType FROM relations WHERE chatId = ? AND (fromEntity LIKE ? OR toEntity LIKE ? OR relationType LIKE ?) LIMIT 15"
    )
    .all(chatId, pattern, pattern, pattern) as Array<{
    fromEntity: string;
    toEntity: string;
    relationType: string;
  }>;

  const lines: string[] = [];

  if (entities.length > 0) {
    lines.push("Entities:");
    for (const e of entities) {
      lines.push(`  • ${e.name} (${e.type})`);
    }
  }

  if (relations.length > 0) {
    lines.push("Relations:");
    for (const r of relations) {
      lines.push(`  • ${r.fromEntity} --[${r.relationType}]--> ${r.toEntity}`);
    }
  }

  return lines.length > 0
    ? lines.join("\n")
    : `No graph entries found matching "${query}".`;
}

/**
 * Get a summary of the knowledge graph for prompt injection.
 */
export function getGraphContext(chatId: number): string {
  const entities = getDb()
    .prepare(
      "SELECT name, type FROM entities WHERE chatId = ? ORDER BY updatedAt DESC LIMIT 40"
    )
    .all(chatId) as Array<{ name: string; type: string }>;

  if (entities.length === 0) return "";

  const relations = getDb()
    .prepare(
      "SELECT fromEntity, relationType, toEntity FROM relations WHERE chatId = ? ORDER BY createdAt DESC LIMIT 40"
    )
    .all(chatId) as Array<{
    fromEntity: string;
    relationType: string;
    toEntity: string;
  }>;

  const lines = ["\n## Knowledge Graph"];
  lines.push(
    "Entities: " + entities.map((e) => `${e.name}(${e.type})`).join(", ")
  );
  if (relations.length > 0) {
    lines.push("Relations:");
    for (const r of relations) {
      lines.push(`- ${r.fromEntity} → ${r.relationType} → ${r.toEntity}`);
    }
  }

  return lines.join("\n");
}

// ── Register Graph Tools ───────────────────────────────────────

export function registerGraphTools(): void {
  registerTool({
    name: "add_entity",
    description:
      "Add or update an entity in the knowledge graph. Use for people, places, projects, concepts, etc.",
    parameters: {
      type: "object",
      properties: {
        name: { type: "string", description: "Entity name" },
        type: {
          type: "string",
          description:
            'Entity type (e.g. "person", "place", "project", "concept")',
        },
        properties: {
          type: "object",
          description: "Additional properties as key-value pairs",
        },
      },
      required: ["name"],
    },
    execute: async (input) => {
      const chatId = input.__chatId as number;
      return addEntity(
        chatId,
        input.name as string,
        (input.type as string) || "thing",
        (input.properties as Record<string, unknown>) || {}
      );
    },
  });

  registerTool({
    name: "add_relation",
    description:
      "Create a relationship between two entities in the knowledge graph.",
    parameters: {
      type: "object",
      properties: {
        from: {
          type: "string",
          description: "Source entity name",
        },
        to: {
          type: "string",
          description: "Target entity name",
        },
        relation: {
          type: "string",
          description:
            'Relationship type (e.g. "works_at", "knows", "uses", "part_of")',
        },
        properties: {
          type: "object",
          description: "Additional properties",
        },
      },
      required: ["from", "to", "relation"],
    },
    execute: async (input) => {
      const chatId = input.__chatId as number;
      return addRelation(
        chatId,
        input.from as string,
        input.to as string,
        input.relation as string,
        (input.properties as Record<string, unknown>) || {}
      );
    },
  });

  registerTool({
    name: "query_graph",
    description:
      "Query the knowledge graph for a specific entity and all its connections.",
    parameters: {
      type: "object",
      properties: {
        entity: {
          type: "string",
          description: "Entity name to query",
        },
      },
      required: ["entity"],
    },
    execute: async (input) => {
      const chatId = input.__chatId as number;
      return queryGraph(chatId, input.entity as string);
    },
  });

  registerTool({
    name: "graph_search",
    description:
      "Search the knowledge graph for entities and relations matching a query.",
    parameters: {
      type: "object",
      properties: {
        query: {
          type: "string",
          description: "Search query",
        },
      },
      required: ["query"],
    },
    execute: async (input) => {
      const chatId = input.__chatId as number;
      return searchGraph(chatId, input.query as string);
    },
  });
}
