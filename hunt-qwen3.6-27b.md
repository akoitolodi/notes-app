Asking qwen3.6-27b to review 8 files...

file:///data/data/com.termux/files/usr/tmp/opencode/notes-app/qa-review.js:69
  throw new Error(`AI API error ${res.status}: ${err.slice(0, 300)}`);
        ^

Error: AI API error 502: {"error":{"message":"All 1 routed attempt(s) failed with upstream provider errors (timeout ×1). This is a provider-side failure, not a problem with your request; retry, or check provider status. Attempt trail: ovh/Qwen3.6-27B key1: timeout. Last error: The operation was aborted (ovh, chat, 60s)","ty
    at file:///data/data/com.termux/files/usr/tmp/opencode/notes-app/qa-review.js:69:9
    at process.processTicksAndRejections (node:internal/process/task_queues:104:5)

Node.js v24.22.2
