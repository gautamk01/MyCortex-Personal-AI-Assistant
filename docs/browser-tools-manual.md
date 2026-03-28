# Browser Tools Manual

Complete guide to all BrowserOS-powered browser tools available in Gravity Claw.

## Prerequisites

- BrowserOS AppImage installed at `~/.local/bin/BrowserOS.AppImage`
- BrowserOS runs on port 9000 — launches automatically on first use
- The browser window is always visible on your desktop during tasks
- BrowserOS uses its own LLM configuration (set it up in BrowserOS settings)

---

## Tool Overview

| Tool | Purpose | When to Use |
|------|---------|-------------|
| `browse` | NL browser actions | Searching, clicking, filling forms, any interaction |
| `browse_read_page` | Read page content | Reading articles, docs, search results |
| `browse_extract` | Structured data extraction | Getting specific data in a defined format |
| `browse_screenshot` | Visual page capture | Seeing what a page looks like |
| `browse_save_pdf` | Export page as PDF | Saving receipts, papers, articles |
| `browse_verify` | Check page state | Confirming an action worked |
| `browse_run_js` | Execute JavaScript | Custom queries, counting elements, page manipulation |
| `browse_tabs` | Tab management | Multi-tab workflows, opening/closing tabs |
| `browseros_run` | Low-level MCP tools | Fine-grained element control (click by ID, etc.) |

---

## 1. `browse` — Natural Language Browser Actions

The primary tool. Tell it what to do in plain English and BrowserOS handles it.

### Basic Usage
```
"Search for 'remote software engineer jobs' on LinkedIn"
```

### With URL (navigate first, then act)
```
Tool: browse
  url: "https://www.google.com"
  instruction: "Search for 'best restaurants in Bangalore'"
```

### With Verification (retry if assertion fails)
```
Tool: browse
  url: "https://amazon.in"
  instruction: "Add the first wireless mouse to cart"
  verify: "Cart shows 1 item"
```
The bot will perform the action, then check if the cart actually shows 1 item. If not, it retries up to 2 times.

### With Context Interpolation
```
Tool: browse
  instruction: "Search for {{query}} and click on the first result"
  context: { "query": "TypeScript tutorial" }
```
Use `{{key}}` syntax in instructions — values are substituted from the context object.

### Multi-Step Actions
```
Tool: browse
  url: "https://github.com"
  instruction: "Go to my repositories, find the most recent one, and star it"
  max_steps: 15
```
Increase `max_steps` for complex multi-step workflows (default: 10).

### Real-World Examples

| Message to Bot | What Happens |
|----------------|-------------|
| "Go to YouTube and search for 'lo-fi beats'" | Opens YouTube, types in search, shows results |
| "Log into my GitHub" | Opens GitHub, detects login state, fills credentials if needed |
| "Fill out this Google Form with my details" | Reads form fields, fills them intelligently |
| "Open Todoist and mark today's tasks as done" | Navigates, finds tasks, clicks complete |

---

## 2. `browse_read_page` — Read Page Content

Gets clean, readable markdown from any webpage. No schema needed — just reads the page.

### Basic Usage
```
Tool: browse_read_page
  url: "https://en.wikipedia.org/wiki/Bangalore"
```
Returns the article text with headers, lists, tables, and links formatted as markdown.

### Read Current Page (no URL)
```
Tool: browse_read_page
```
Reads whatever page is currently open in BrowserOS.

### Real-World Examples

| Message to Bot | What Happens |
|----------------|-------------|
| "Read this article and summarize it: [URL]" | Reads markdown, LLM summarizes |
| "What does this documentation page say?" | Extracts all text content |
| "Get the search results from this Google search" | Returns results as markdown |

### Tips
- Best for articles, docs, blog posts, search results
- Returns full page text — the LLM can then summarize or answer questions about it
- For structured data (tables, lists with specific fields), use `browse_extract` instead

---

## 3. `browse_extract` — Structured Data Extraction

Extract specific data from a page in a structured format. You define the shape of the output.

### Basic Usage
```
Tool: browse_extract
  instruction: "Get all product names and prices"
  schema: {
    "type": "object",
    "properties": {
      "products": {
        "type": "array",
        "items": {
          "type": "object",
          "properties": {
            "name": { "type": "string" },
            "price": { "type": "number" }
          }
        }
      }
    }
  }
```

### Real-World Examples

| Message to Bot | Schema Shape | Returns |
|----------------|-------------|---------|
| "Get all job titles and companies from this page" | `{jobs: [{title, company, location}]}` | Structured job list |
| "Extract the table of contents" | `{sections: [{title, level}]}` | Heading tree |
| "What are the opening hours?" | `{hours: [{day, open, close}]}` | Schedule data |

### Tips
- Navigate to the page first using `browse` or the `url` param on other tools
- The schema is JSON Schema format (same as OpenAI function calling)
- Keep schemas simple — BrowserOS will fill in what it can find

---

## 4. `browse_screenshot` — Visual Page Capture

Take a screenshot of the browser and get it as image data.

### Basic Usage
```
Tool: browse_screenshot
  url: "https://github.com/your-username"
```

### Full Page Screenshot
```
Tool: browse_screenshot
  url: "https://example.com/long-article"
  full_page: true
```
Captures the entire scrollable page, not just the visible viewport.

### Current Page Screenshot
```
Tool: browse_screenshot
```
Screenshots whatever is currently displayed.

### Real-World Examples

| Message to Bot | What Happens |
|----------------|-------------|
| "Show me what my portfolio site looks like" | Screenshots and sends image |
| "Take a screenshot of these search results" | Captures visible results |
| "Screenshot the full page of this article" | Scrolling full-page capture |

---

## 5. `browse_save_pdf` — Export as PDF

Save any webpage as a PDF document.

### Basic Usage
```
Tool: browse_save_pdf
  url: "https://arxiv.org/abs/2301.00001"
```

### With Custom Filename
```
Tool: browse_save_pdf
  url: "https://amazon.in/order/123"
  filename: "amazon-receipt-march-2026"
```

### Real-World Examples

| Message to Bot | What Happens |
|----------------|-------------|
| "Save this research paper as a PDF" | Exports and saves PDF |
| "Download my Amazon order confirmation" | Navigates, exports PDF |
| "Save this recipe page for offline reading" | Exports clean PDF |

---

## 6. `browse_verify` — Check Page State

Assert that the current page matches an expected state. Returns pass/fail with reasoning.

### Basic Usage
```
Tool: browse_verify
  expectation: "The user is logged in"
```

### Real-World Examples

| Expectation | Returns |
|-------------|---------|
| "The shopping cart has 3 items" | `{ success: true, reason: "Cart badge shows 3" }` |
| "Login form is visible" | `{ success: true, reason: "Email and password fields present" }` |
| "The page shows search results" | `{ success: false, reason: "Page shows 'no results found'" }` |

### Tips
- Use after `browse` actions to confirm they worked
- The `browse` tool has a built-in `verify` parameter that auto-retries on failure

---

## 7. `browse_run_js` — Execute JavaScript

Run arbitrary JavaScript on the current page and get the result.

### Basic Usage
```
Tool: browse_run_js
  code: "document.title"
```

### Count Elements
```
Tool: browse_run_js
  code: "document.querySelectorAll('img').length"
```

### Extract Specific Data
```
Tool: browse_run_js
  code: "Array.from(document.querySelectorAll('a')).map(a => ({text: a.textContent, href: a.href})).slice(0, 10)"
```

### Check Page State
```
Tool: browse_run_js
  url: "https://example.com/dashboard"
  code: "document.querySelector('.user-name')?.textContent"
```

### Real-World Examples

| Message to Bot | JS Code | Returns |
|----------------|---------|---------|
| "How many images on this page?" | `document.querySelectorAll('img').length` | `47` |
| "What's the page title?" | `document.title` | `"GitHub - your-repo"` |
| "Get all link URLs" | `Array.from(document.querySelectorAll('a')).map(a => a.href)` | `["url1", "url2", ...]` |
| "Is there a login button?" | `!!document.querySelector('[data-testid="login"]')` | `true` / `false` |

### Tips
- The code runs in the page's browser context (has access to DOM, window, etc.)
- Return value must be JSON-serializable
- Use for quick queries that don't need the full NL overhead of `browse`

---

## 8. `browse_tabs` — Tab Management

Manage multiple browser tabs for parallel workflows.

### List Open Tabs
```
Tool: browse_tabs
  action: "list"
```
Returns all open tabs with their IDs, URLs, and titles.

### Open a New Tab
```
Tool: browse_tabs
  action: "open"
  url: "https://linkedin.com"
```

### Close a Tab
```
Tool: browse_tabs
  action: "close"
  tab_id: 3
```
Use `list` first to get tab IDs.

### Real-World Examples

| Message to Bot | What Happens |
|----------------|-------------|
| "Open LinkedIn and GitHub side by side" | Opens 2 tabs |
| "What tabs do I have open?" | Lists all tabs |
| "Close the YouTube tab" | Lists tabs, finds YouTube, closes it |
| "Compare prices on Amazon and Flipkart" | Opens both, browses each |

---

## 9. `browseros_run` — Low-Level MCP Tools (Advanced)

Direct access to BrowserOS's 58 MCP tools. Use when high-level tools aren't precise enough.

### First: Discover Available Tools
```
Tool: browseros_list_tools
```
Returns all available MCP tools with their parameters.

### Then: Call Specific Tools
```
Tool: browseros_run
  tool_name: "click"
  arguments: { "page": 1, "element": 42 }
```

### Key MCP Tools

| Tool | What it Does |
|------|-------------|
| `take_snapshot` | Get accessibility tree with clickable element IDs |
| `click` | Click element by ID from snapshot |
| `fill` | Type into input field |
| `press_key` | Press keyboard key (Enter, Tab, Ctrl+A) |
| `scroll` | Scroll page or element |
| `get_dom` | Query DOM with CSS selectors |
| `handle_dialog` | Accept/dismiss browser dialogs |
| `upload_file` | Upload a file to a file input |
| `get_console_logs` | Read browser console output |

### When to Use Low-Level Tools
- Clicking a specific element by its accessibility ID
- Interacting with complex UI widgets (sliders, date pickers)
- Uploading files
- Handling browser dialogs (alerts, confirms)
- Reading browser console logs for debugging

---

## Workflow Patterns

### Pattern 1: Research + Summarize
```
1. browse_read_page(url: "https://arxiv.org/abs/...")  → get article text
2. LLM summarizes the content
3. Send summary to Telegram
```

### Pattern 2: Search + Screenshot
```
1. browse(url: "https://google.com", instruction: "search for 'remote jobs'")
2. browse_screenshot()  → capture results
3. Send screenshot to Telegram
```

### Pattern 3: Navigate + Extract + Save
```
1. browse(url: "https://amazon.in/orders", instruction: "go to my recent orders")
2. browse_extract(instruction: "get order IDs, dates, and amounts", schema: {...})
3. browse_save_pdf()  → save as receipt
```

### Pattern 4: Multi-Tab Comparison
```
1. browse_tabs(action: "open", url: "https://amazon.in/product/123")
2. browse_tabs(action: "open", url: "https://flipkart.com/product/456")
3. browse_read_page() on each tab
4. LLM compares the two products
```

### Pattern 5: Form Fill + Verify
```
1. browse(url: "https://forms.google.com/...", instruction: "fill the form with my name and email")
2. browse_verify(expectation: "all required fields are filled")
3. browse(instruction: "click submit")
4. browse_verify(expectation: "submission confirmation is shown")
```

---

## Timeout & Error Handling

- All browser tools have a **120-second timeout** — if a task takes longer, it fails gracefully
- On connection loss, the SDK agent **auto-reconnects** on the next call
- BrowserOS **launches automatically** if not running when any browser tool is called
- The browser window is **brought to front** automatically so you can watch actions happen

---

## Tips & Best Practices

1. **Start with `browse`** — it handles 80% of browser tasks via natural language
2. **Use `browse_read_page`** before asking the LLM to summarize or answer questions about a page
3. **Use `browse_screenshot`** when the user wants visual feedback ("show me", "what does it look like")
4. **Use `browse_extract`** only when you need data in a specific structure (JSON)
5. **Use `browse_run_js`** as a power-user escape hatch for quick DOM queries
6. **Avoid `browseros_run`** unless you need element-level precision — the high-level tools are faster and easier
7. **Chain tools** — navigate with `browse`, read with `browse_read_page`, verify with `browse_verify`
8. **Use verification** — the `browse` tool's `verify` param auto-retries failed actions
