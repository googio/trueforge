---
'@truefoundry/trueforge-core': patch
---

Stamp `x-tfy-request-id` on each model call and log that id with model name and gateway URL on Body Timeout so harness logs can be correlated with AI Gateway traces.
