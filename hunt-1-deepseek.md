Asking deepseek-v4-flash to review 8 files...

file:///data/data/com.termux/files/usr/tmp/opencode/notes-app/qa-review.js:69
  throw new Error(`AI API error ${res.status}: ${err.slice(0, 300)}`);
        ^

Error: AI API error 503: {"error":{"message":"No candidate model has a configured, usable provider key. Add provider API keys in the dashboard. All models exhausted. Add more API keys or wait for rate limits to reset. Soonest reset ~18s. 3 models skipped: no key configured for their platform.","type":"service_unavailable","
    at file:///data/data/com.termux/files/usr/tmp/opencode/notes-app/qa-review.js:69:9
    at process.processTicksAndRejections (node:internal/process/task_queues:104:5)

Node.js v24.22.2
