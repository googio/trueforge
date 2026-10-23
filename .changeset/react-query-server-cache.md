---
"@truefoundry/trueforge-ui": patch
---

Cache server reads with React Query so repeated catalog, permission, session, agent, settings, schedule, environment, and metrics requests are deduplicated and refreshed after mutations. Reopening an idle chat from history reuses its cached events instead of calling `listEvents` again.
