import { registerTool } from "./index.js";

// ── Browser Automation Tools ───────────────────────────────────
// Uses Playwright for headless browser control.
// Lazy-loads Playwright to avoid startup cost if unused.

let browserInstance: import("playwright").Browser | null = null;
let pageInstance: import("playwright").Page | null = null;
let currentMode: "gui" | "terminal" = "terminal";

export async function setBrowserMode(mode: "gui" | "terminal"): Promise<void> {
  if (currentMode !== mode) {
    currentMode = mode;
    await closeBrowser(); // Re-launch with new settings next time
  }
}

async function getPage(): Promise<import("playwright").Page> {
  if (pageInstance && browserInstance?.isConnected()) {
    return pageInstance;
  }

  const { chromium } = await import("playwright");
  const isGui = currentMode === "gui";
  browserInstance = await chromium.launch({ 
    headless: !isGui, 
    slowMo: isGui ? 500 : 0 
  });
  const context = await browserInstance.newContext({
    viewport: { width: 1280, height: 720 },
    userAgent:
      "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
  });
  pageInstance = await context.newPage();
  return pageInstance;
}

/** Close browser (used on shutdown). */
export async function closeBrowser(): Promise<void> {
  if (browserInstance) {
    await browserInstance.close().catch(() => {});
    browserInstance = null;
    pageInstance = null;
  }
}

// ── browser_navigate ───────────────────────────────────────────

registerTool({
  name: "browser_navigate",
  description:
    "Navigate to a URL in the browser and return the page title and a text summary. " +
    "In GUI mode the browser is visible; in Terminal mode it runs in the background. " +
    "Use this to visit web pages, read articles, check websites.",
  parameters: {
    type: "object",
    properties: {
      url: { type: "string", description: "The URL to navigate to" },
      wait_for: {
        type: "string",
        description: "CSS selector to wait for before returning (optional)",
      },
    },
    required: ["url"],
  },
  execute: async (input) => {
    try {
      const page = await getPage();
      const url = input.url as string;
      const waitFor = input.wait_for as string | undefined;

      await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30000 });

      if (waitFor) {
        await page.waitForSelector(waitFor, { timeout: 10000 }).catch(() => {});
      }

      const title = await page.title();
      const text = await page
        .evaluate(() => {
          const body = document.body;
          // Remove scripts and styles
          body.querySelectorAll("script, style, noscript").forEach((el) => el.remove());
          return body.innerText.slice(0, 5000);
        });

      return JSON.stringify({ url: page.url(), title, content: text });
    } catch (error) {
      return JSON.stringify({
        error: error instanceof Error ? error.message : String(error),
      });
    }
  },
});

// ── browser_click ──────────────────────────────────────────────

registerTool({
  name: "browser_click",
  description:
    "Click on an element in the current browser page using a CSS selector.",
  parameters: {
    type: "object",
    properties: {
      selector: {
        type: "string",
        description: "CSS selector of the element to click",
      },
    },
    required: ["selector"],
  },
  execute: async (input) => {
    try {
      const page = await getPage();
      await page.click(input.selector as string, { timeout: 10000 });
      await page.waitForLoadState("domcontentloaded").catch(() => {});
      const title = await page.title();
      return JSON.stringify({ success: true, url: page.url(), title });
    } catch (error) {
      return JSON.stringify({
        error: error instanceof Error ? error.message : String(error),
      });
    }
  },
});

// ── browser_type ───────────────────────────────────────────────

registerTool({
  name: "browser_type",
  description:
    "Type text into an input field on the current browser page.",
  parameters: {
    type: "object",
    properties: {
      selector: {
        type: "string",
        description: "CSS selector of the input element",
      },
      text: { type: "string", description: "Text to type into the element" },
      submit: {
        type: "boolean",
        description: "If true, press Enter after typing (default: false)",
      },
    },
    required: ["selector", "text"],
  },
  execute: async (input) => {
    try {
      const page = await getPage();
      const selector = input.selector as string;
      const text = input.text as string;
      const submit = (input.submit as boolean) ?? false;

      await page.fill(selector, text, { timeout: 10000 });
      if (submit) {
        await page.press(selector, "Enter");
        await page.waitForLoadState("domcontentloaded").catch(() => {});
      }

      return JSON.stringify({ success: true, typed: text, url: page.url() });
    } catch (error) {
      return JSON.stringify({
        error: error instanceof Error ? error.message : String(error),
      });
    }
  },
});

// ── browser_screenshot ─────────────────────────────────────────

registerTool({
  name: "browser_screenshot",
  description:
    "Take a screenshot of the current browser page. Returns a description of visible content " +
    "(since images can't be sent directly via tool results).",
  parameters: {
    type: "object",
    properties: {
      full_page: {
        type: "boolean",
        description: "If true, capture the full scrollable page (default: false)",
      },
    },
    required: [],
  },
  execute: async (input) => {
    try {
      const page = await getPage();
      const fullPage = (input.full_page as boolean) ?? false;

      // Save screenshot to temp file
      const path = `/tmp/gravity-claw-screenshot-${Date.now()}.png`;
      await page.screenshot({ path, fullPage });

      const title = await page.title();
      const url = page.url();
      const text = await page.evaluate(() => document.body.innerText.slice(0, 2000));

      return JSON.stringify({
        success: true,
        screenshotPath: path,
        url,
        title,
        visibleContent: text,
      });
    } catch (error) {
      return JSON.stringify({
        error: error instanceof Error ? error.message : String(error),
      });
    }
  },
});

// ── browser_extract_content ────────────────────────────────────

registerTool({
  name: "browser_extract_content",
  description:
    "Extract structured content from the current browser page. " +
    "Can extract all text, all links, or content matching a CSS selector.",
  parameters: {
    type: "object",
    properties: {
      selector: {
        type: "string",
        description: "CSS selector to extract content from (default: 'body')",
      },
      extract_type: {
        type: "string",
        enum: ["text", "links", "html"],
        description: "Type of content to extract: 'text', 'links', or 'html' (default: 'text')",
      },
    },
    required: [],
  },
  execute: async (input) => {
    try {
      const page = await getPage();
      const selector = (input.selector as string) ?? "body";
      const extractType = (input.extract_type as string) ?? "text";

      if (extractType === "links") {
        const links = await page.evaluate((sel) => {
          const container = document.querySelector(sel) ?? document.body;
          return Array.from(container.querySelectorAll("a[href]"))
            .map((a) => ({
              text: (a as HTMLAnchorElement).innerText.trim().slice(0, 100),
              href: (a as HTMLAnchorElement).href,
            }))
            .filter((l) => l.text && l.href)
            .slice(0, 50);
        }, selector);
        return JSON.stringify({ links, count: links.length });
      }

      if (extractType === "html") {
        const html = await page.evaluate((sel) => {
          const el = document.querySelector(sel);
          return el ? el.innerHTML.slice(0, 5000) : "Element not found";
        }, selector);
        return JSON.stringify({ html });
      }

      // Default: text
      const text = await page.evaluate((sel) => {
        const el = document.querySelector(sel);
        return el ? (el as HTMLElement).innerText.slice(0, 5000) : "Element not found";
      }, selector);
      return JSON.stringify({ text });
    } catch (error) {
      return JSON.stringify({
        error: error instanceof Error ? error.message : String(error),
      });
    }
  },
});
