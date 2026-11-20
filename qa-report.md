Asking gemini-3.8-flash to review 8 files...

file:///data/data/com.termux/files/usr/tmp/opencode/notes-app/qa-review.js:69
  throw new Error(`AI API error ${res.status}: ${err.slice(0, 300)}`);
        ^

Error: AI API error 502: {"error":{"message":"All 1 routed attempt(s) failed with upstream provider errors (upstream_error ×1). This is a provider-side failure, not a problem with your request; retry, or check provider status. Attempt trail: google/gemini-3.8-flash key1: upstream_error. Last error: Google API error 503: Thi
    at file:///data/data/com.termux/files/usr/tmp/opencode/notes-app/qa-review.js:69:9
    at process.processTicksAndRejections (node:internal/process/task_queues:104:5)

Node.js v24.22.2
