import { registerTool } from "./index.js";
import { bot } from "../bot.js";

const ALLOWED_REACTIONS = [
  "👍", "👎", "❤️", "🔥", "🥰", "👏", "😁", "🤔", "🤯", "😱", "🤬", "😢", "🎉", "🤩", "🤮", "💩", "🙏", "👌", "🕊", "🤡", "🥱", "🥴", "😍", "🐳", "❤️‍🔥", "🌚", "🌭", "💯", "🤣", "⚡", "🍌", "🏆", "💔", "🤨", "😐", "🍓", "🍾", "💋", "🖕", "😈", "😴", "😭", "🤓", "👻", "👨‍💻", "👀", "🎃", "🎄", "☃️", "💅", "🤪", "🗿", "🆒", "💘", "🙊", "🦄", "😘", "💊", "😎", "👾", "🤷", "😡"
];

registerTool({
  name: "react_to_message",
  description:
    "React to the user's last message with an emoji based on the context. Only the following emojis are allowed: " + ALLOWED_REACTIONS.join(", ") + ". You are highly encouraged to use this tool autonomously whenever a message evokes emotion, agreement, or support.",
  parameters: {
    type: "object",
    properties: {
      emoji: {
        type: "string",
        description: "The emoji to react with. MUST be from the allowed list: " + ALLOWED_REACTIONS.join(", ") + ".",
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

    // Safety fallback: If AI picks an invalid emoji, use 👍 instead of failing
    const finalEmoji = ALLOWED_REACTIONS.includes(emoji) ? emoji : "👍";

    try {
      await bot.api.setMessageReaction(__chatId, __messageId, [
        { type: "emoji", emoji: finalEmoji as any },
      ]);
      return `Successfully reacted with ${finalEmoji}. Now continue to generate the text response.`;
    } catch (error) {
      const errMsg = error instanceof Error ? error.message : String(error);
      return `Failed to react with emoji: ${errMsg}`;
    }
  },
});
