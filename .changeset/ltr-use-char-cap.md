---
'@truefoundry/trueforge-core': patch
---

Large tool response guidance now includes content size in the blocked preamble for MCP and sandbox dumps, shares the same "Content too big (size; reason)" framing, and states the per-response character limit for dumped-file reads and oversized sandbox stdout. Elevated per-tool character limits skip offload for listed tools (e.g. `get_tool_info` up to 50,000 characters).
