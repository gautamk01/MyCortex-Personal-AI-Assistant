---
name: Summarizer
description: Summarize long text, articles, or documents into concise bullet points
triggers: summarize, summary, tldr, brief
---

When asked to summarize content, follow these steps:

1. If given a URL, use the browser_navigate tool to fetch the page content
2. If given a file path, use read_file to get the contents
3. Identify the key points, main arguments, and conclusions
4. Present a summary with:
   - A one-sentence overview
   - 3-5 bullet points covering the main ideas
   - Any important caveats or nuances
5. Keep the summary under 200 words unless asked for more detail
