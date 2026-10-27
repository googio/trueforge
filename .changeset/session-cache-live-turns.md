---
"@truefoundry/trueforge-assistant-ui-runtime": patch
"@truefoundry/trueforge-ui": patch
---

Sessions report their most recent turn as `lastTurnId`, so cached chat history is reused only when it ends on that finished turn. Session lists are marked stale when a turn starts or ends. Reopening a cached idle chat paints its history at once through the optional `peekEvents` server method, and a send waits until the confirmed load replaces it.

Older chat history no longer drops a turn whose newest events landed on the newer page, which hid that turn after another tab added a message. Switching back to a chat created in the current tab reloads it, so turns added elsewhere appear, and a rejected approval or answer reloads the chat in case another tab already handled it. Server queries resume after the browser comes back online, opening a session reads its permissions fresh, permission grants of one resource type never stand in for another, and the Agents library usage window moves forward on refresh.
