---
'@truefoundry/trueforge-core': patch
'@truefoundry/trueforge': patch
---

Strip hop/auth headers from `x-tfg-mcp-headers` overrides, and strip `x-tfy-actor-authorization` on cross-origin outbound redirects.
