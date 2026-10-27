---
"@truefoundry/trueforge": patch
"@truefoundry/trueforge-ui": patch
"@truefoundry/trueforge-assistant-ui-runtime": patch
"@truefoundry/trueforge-sdk": patch
---

Add MCP `auth.type: passthrough` to forward the caller's bearer token, plus optional manifest `additional_headers` (auth wins on conflict), with settings UI support.
