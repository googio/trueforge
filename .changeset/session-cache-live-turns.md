---
"@truefoundry/trueforge-assistant-ui-runtime": patch
"@truefoundry/trueforge-ui": patch
---

Sessions report their most recent turn as `lastTurnId`, so cached chat history is reused only when it ends on that finished turn. Session lists refresh when a turn starts or ends. Reopening a cached idle chat paints its history at once through the optional `peekEvents` server method, then replaces it with the confirmed load.
