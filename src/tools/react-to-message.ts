import { registerTool } from "./index.js";
import { bot } from "../bot.js";

registerTool({
  name: "react_to_message",
  description:
    "React to the user's last message with an emoji based on the context (e.g., 👍, ❤️, 🔥). Use this when you want to show agreement, love, or excitement. You must still provide a helpful text response after using this tool.",
  parameters: {
    type: "object",
    properties: {
      emoji: {
        type: "string",
        description: "The emoji to react with (e.g., 👍, ❤️, 🔥, 🎉, 👎, 👏, 😂, 🤔, 😢, 🤯, 🤬, 💩, 🤮, 🤝, ✍️, 💅, 🤷, 🖕, 🤓, 🥱, 🥴, 🤫).",
      },
    },
    required: ["emoji"],
  },
  execute: async (input: Record<string, unknown>) => {
    const { __chatId, __messageId, emoji } = input;
    
    if (typeof __chatId !== "number" || typeof __messageId !== "number") {
      return "Error: __chatId or __messageId is missing or invalid.";
    }
    
    if (typeof emoji !== "string" || !emoji) {
      return "Error: emoji parameter is required and must be a string.";
    }

    try {
      await bot.api.setMessageReaction(__chatId, __messageId, [
        { type: "emoji", emoji: emoji as any },
      ]);
      return `Successfully reacted with ${emoji}. Now continue to generate the text response.`;
    } catch (error) {
      const errMsg = error instanceof Error ? error.message : String(error);
      return `Failed to react with emoji: ${errMsg}`;
    }
  },
});
