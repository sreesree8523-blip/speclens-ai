---
name: AI provider setup
description: Fallback behavior when managed AI setup is unavailable and provider credentials are supplied directly.
---

When managed AI setup requires a plan upgrade and the user declines, do not retry setup. If the user chooses direct provider access, request its key through Replit Secrets and keep provider calls server-side. A configured key does not guarantee usable quota; distinguish quota exhaustion from transient failures and never save an analysis that the provider did not complete.

**Why:** SpecLens could not provision managed OpenAI access without an upgrade; the user chose direct OpenAI credentials, and the provider account had no remaining API credits.

**How to apply:** Check managed setup results before implementation; respect a declined upgrade, use the secure secrets flow for any approved direct key, and report quota/configuration failures without fabricating output.
