/**
 * Maps a tool name + args JSON into a human-readable progress string.
 * Used by voice pipelines, Telegram bot, and voice agent UI.
 */
export function describeToolAction(toolName: string, argsJson: string): string {
  try {
    const args = safeParseJson(argsJson);

    switch (toolName) {
      // ── Web search ──
      case "web_search":
        return args.query ? `🔍 Searching: "${truncate(args.query, 35)}"` : "🔍 Searching...";

      // ── Browser ──
      case "browse":
        return `🌐 Visiting: ${safeHostname(args.url)}`;
      case "browse_read_page":
        return `📖 Reading: ${safeHostname(args.url)}`;
      case "browse_extract":
        return `📊 Extracting: ${safeHostname(args.url)}`;
      case "browse_verify":
        return `✅ Verifying: ${safeHostname(args.url)}`;
      case "browse_screenshot":
        return "📸 Taking screenshot";
      case "browse_save_pdf":
        return "📄 Saving PDF";
      case "browse_run_js":
        return "⚡ Running script";
      case "browse_tabs":
        return "🗂️ Managing tabs";
      case "browser_navigate":
        return `🌐 Navigating: ${safeHostname(args.url)}`;
      case "browser_click":
        return "🖱️ Clicking element";
      case "browser_type":
        return "⌨️ Typing text";
      case "browser_screenshot":
        return "📸 Taking screenshot";
      case "browser_extract_content":
        return "📊 Extracting content";

      // ── Files ──
      case "read_file":
        return `📂 Reading: ${baseName(args.path)}`;
      case "write_file":
        return `✏️ Writing: ${baseName(args.path)}`;
      case "delete_file":
        return `🗑️ Deleting: ${baseName(args.path)}`;
      case "list_directory":
        return `📁 Listing: ${baseName(args.path)}`;
      case "search_files":
        return args.pattern ? `🔎 Searching: "${truncate(args.pattern, 25)}"` : "🔎 Searching files";
      case "file_info":
        return `ℹ️ Checking: ${baseName(args.path)}`;

      // ── Shell / Terminal ──
      case "run_shell_command":
        return args.command ? `💻 Running: ${truncate(args.command, 25)}` : "💻 Running command";
      case "open_terminal":
      case "open_terminal_gui":
        return "🖥️ Opening terminal";
      case "terminal_run":
        return args.command ? `🖥️ Running: ${truncate(args.command, 25)}` : "🖥️ Terminal command";
      case "terminal_status":
        return "🖥️ Checking terminal";
      case "close_terminal":
        return "🖥️ Closing terminal";
      case "type_in_terminal":
      case "send_keys_to_terminal":
        return "🖥️ Typing in terminal";

      // ── Memory ──
      case "remember":
        return "💾 Saving to memory";
      case "recall":
        return args.query ? `🧠 Recalling: "${truncate(args.query, 25)}"` : "🧠 Checking memory";
      case "forget":
        return "🧹 Forgetting";
      case "memory_stats":
        return "🧠 Memory stats";
      case "memory_maintain":
        return "🧠 Maintaining memory";

      // ── Notes ──
      case "save_note":
        return "📝 Saving note";
      case "read_notes":
      case "list_notes":
        return "📝 Reading notes";
      case "search_notes":
        return "📝 Searching notes";
      case "delete_note":
        return "📝 Deleting note";

      // ── Knowledge Graph ──
      case "add_entity":
        return args.name ? `🕸️ Adding: ${truncate(args.name, 25)}` : "🕸️ Adding entity";
      case "add_relation":
        return "🕸️ Adding relation";
      case "query_graph":
      case "graph_search":
        return "🕸️ Querying graph";

      // ── Daily plan / tasks ──
      case "create_daily_plan":
      case "get_daily_plan":
      case "update_daily_plan_item":
      case "complete_daily_plan_item":
      case "sync_daily_plan_to_todoist":
      case "run_evening_review":
        return "📅 Updating plan";
      case "fetch_today_tasks":
      case "add_todoist_task":
      case "complete_todoist_task":
        return "✅ Todoist";

      // ── Reminders ──
      case "create_reminder":
        return "⏰ Setting reminder";
      case "list_reminders":
        return "⏰ Checking reminders";
      case "cancel_reminder":
      case "snooze_reminder":
        return "⏰ Updating reminder";

      // ── Gamification / Logging ──
      case "check_level":
      case "log_habit":
        return "🎮 Gamification";
      case "log_leetcode_to_sheet":
      case "get_leetcode_logs":
      case "update_leetcode_log":
      case "delete_leetcode_log":
        return "📊 LeetCode log";
      case "log_company":
      case "get_company_logs":
      case "update_company_log":
      case "delete_company_log":
        return "📊 Company tracker";
      case "log_work_session":
      case "get_work_logs":
      case "update_work_log":
      case "delete_work_log":
      case "summarize_work_logs":
        return "📊 Work log";
      case "log_life_event":
      case "get_life_logs":
      case "update_life_log":
      case "delete_life_log":
      case "summarize_life_logs":
        return "📊 Life log";

      // ── Coach / summaries ──
      case "get_daily_summary":
      case "list_daily_summaries":
        return "📋 Daily summary";

      // ── Desktop ──
      case "open_folder":
        return `📁 Opening: ${baseName(args.path)}`;
      case "open_file":
        return `📂 Opening: ${baseName(args.path)}`;
      case "open_app":
        return args.app_name ? `🖥️ Opening: ${args.app_name}` : "🖥️ Opening app";
      case "open_url":
        return `🌐 Opening: ${safeHostname(args.url)}`;

      // ── Media ──
      case "store_media_memory":
        return "📷 Storing media";
      case "search_media":
        return "📷 Searching media";

      // ── Codex ──
      case "codex_ask":
        return "🤖 Asking Codex";
      case "codex_set_dir":
        return "🤖 Setting Codex dir";

      // ── BrowserOS MCP ──
      case "browseros_list_tools":
        return "🌐 Listing browser tools";
      case "browseros_run":
        return args.tool ? `🌐 BrowserOS: ${args.tool}` : "🌐 BrowserOS action";

      // ── Misc ──
      case "react_to_message":
        return "😀 Reacting";
      case "get_current_time":
        return "🕐 Checking time";

      default:
        return `⚙️ Using ${toolName}`;
    }
  } catch {
    return `⚙️ Using ${toolName}`;
  }
}

// ── Helpers ──────────────────────────────────────────────────

function safeParseJson(json: string): Record<string, string> {
  try {
    return JSON.parse(json || "{}") as Record<string, string>;
  } catch {
    return {};
  }
}

function safeHostname(url: string | undefined): string {
  if (!url) return "page";
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "page";
  }
}

function baseName(path: string | undefined): string {
  if (!path) return "file";
  const parts = path.replace(/\\/g, "/").split("/");
  return parts[parts.length - 1] || "file";
}

function truncate(s: string, maxLen: number): string {
  return s.length > maxLen ? s.slice(0, maxLen - 1) + "…" : s;
}
