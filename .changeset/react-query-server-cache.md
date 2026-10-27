---
"@truefoundry/trueforge-assistant-ui-runtime": patch
"@truefoundry/trueforge-ui": patch
---

Cache server reads with React Query, and reuse idle chat history via `lastTurnId` / `peekEvents` so reopening a session paints immediately and stays correct across tabs and pagination.
