/**
 * Offline Dev & IT Pocket Toolkit — 100% pure local math/parsers, 0 API calls.
 * Powers the optional, toggleable Dev & IT Toolkit screen.
 */

// ---------------- 1. IPv4 / CIDR Subnet Calculator ----------------

function intToIpv4(num) {
  const n = num >>> 0;
  return [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255].join('.');
}

function intToBinaryOctets(num) {
  const n = num >>> 0;
  return [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255]
    .map(b => b.toString(2).padStart(8, '0'))
    .join('.');
}

export function calculateSubnet(input) {
  const clean = String(input || '').trim();
  const match = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})(?:\/(\d{1,2}))?$/.exec(clean);
  if (!match) {
    throw new Error('Enter a valid IPv4/CIDR address (e.g. 192.168.1.42/26).');
  }
  const octets = [match[1], match[2], match[3], match[4]].map(Number);
  if (octets.some(o => o < 0 || o > 255)) {
    throw new Error('Each IPv4 octet must be between 0 and 255.');
  }
  const prefix = match[5] !== undefined ? Number(match[5]) : 24;
  if (!Number.isInteger(prefix) || prefix < 0 || prefix > 32) {
    throw new Error('CIDR prefix must be between /0 and /32.');
  }

  const ipInt = (((octets[0] << 24) | (octets[1] << 16) | (octets[2] << 8) | octets[3]) >>> 0);
  const maskInt = prefix === 0 ? 0 : (0xffffffff << (32 - prefix)) >>> 0;
  const wildcardInt = (~maskInt) >>> 0;
  const networkInt = (ipInt & maskInt) >>> 0;
  const broadcastInt = (networkInt | wildcardInt) >>> 0;
  const totalAddresses = Math.pow(2, 32 - prefix);

  let usableHosts;
  let firstUsable;
  let lastUsable;
  if (prefix === 32) {
    usableHosts = 1;
    firstUsable = intToIpv4(networkInt);
    lastUsable = intToIpv4(networkInt);
  } else if (prefix === 31) {
    usableHosts = 2; // RFC 3021 point-to-point link
    firstUsable = intToIpv4(networkInt);
    lastUsable = intToIpv4(broadcastInt);
  } else {
    usableHosts = Math.max(0, totalAddresses - 2);
    firstUsable = intToIpv4((networkInt + 1) >>> 0);
    lastUsable = intToIpv4((broadcastInt - 1) >>> 0);
  }

  const o0 = octets[0];
  const o1 = octets[1];
  const ipClass =
    o0 < 128 ? 'Class A' : o0 < 192 ? 'Class B' : o0 < 224 ? 'Class C' : o0 < 240 ? 'Class D (Multicast)' : 'Class E';
  const isPrivate =
    o0 === 10 ||
    (o0 === 172 && o1 >= 16 && o1 <= 31) ||
    (o0 === 192 && o1 === 168) ||
    o0 === 127;

  return {
    ip: intToIpv4(ipInt),
    prefix,
    cidr: `${intToIpv4(networkInt)}/${prefix}`,
    networkAddress: intToIpv4(networkInt),
    broadcastAddress: intToIpv4(broadcastInt),
    firstUsable,
    lastUsable,
    usableHosts,
    totalAddresses,
    subnetMask: intToIpv4(maskInt),
    wildcardMask: intToIpv4(wildcardInt),
    ipClass,
    scope: o0 === 127 ? 'Loopback' : isPrivate ? 'Private (RFC 1918)' : 'Public',
    binaryIp: intToBinaryOctets(ipInt),
    binaryMask: intToBinaryOctets(maskInt),
    binaryNetwork: intToBinaryOctets(networkInt),
  };
}

// ---------------- 2. Number Base & Bitwise Converter ----------------

export function convertNumberBase(rawValue, fromBase = 10) {
  const clean = String(rawValue || '')
    .trim()
    .replace(/[\s_]/g, '')
    .replace(/^0[bBoOxX]/, '');
  if (!clean) return { bin: '', oct: '', dec: '', hex: '' };

  const patterns = {
    2: /^[01]+$/,
    8: /^[0-7]+$/,
    10: /^\d+$/,
    16: /^[0-9a-fA-F]+$/,
  };
  if (!patterns[fromBase]?.test(clean)) {
    throw new Error(`Invalid base-${fromBase} number.`);
  }

  const prefix = fromBase === 2 ? '0b' : fromBase === 8 ? '0o' : fromBase === 16 ? '0x' : '';
  const val = BigInt(prefix + clean);
  return {
    bin: val.toString(2),
    oct: val.toString(8),
    dec: val.toString(10),
    hex: val.toString(16).toUpperCase(),
  };
}

export function computeBitwise(aDec, bDec, op) {
  const a = BigInt(String(aDec || '0').trim() || '0');
  const b = BigInt(String(bDec || '0').trim() || '0');
  const zero = BigInt(0);
  const maxShift = BigInt(64);
  const clampedShift = b < zero ? zero : b > maxShift ? maxShift : b;
  let res;
  switch (op) {
    case 'AND': res = a & b; break;
    case 'OR': res = a | b; break;
    case 'XOR': res = a ^ b; break;
    case 'SHL': res = a << clampedShift; break;
    case 'SHR': res = a >> clampedShift; break;
    default: res = a & b;
  }
  return {
    dec: res.toString(10),
    bin: res.toString(2),
    hex: res.toString(16).toUpperCase(),
  };
}

// ---------------- 3. JSON, Base64, URL & Offline JWT Inspector ----------------

export function formatJsonSafe(raw) {
  const parsed = JSON.parse(String(raw || ''));
  return {
    pretty: JSON.stringify(parsed, null, 2),
    minified: JSON.stringify(parsed),
    keysCount: parsed && typeof parsed === 'object' ? Object.keys(parsed).length : 0,
  };
}

export function encodeBase64Utf8(str) {
  const bytes = new TextEncoder().encode(String(str || ''));
  let bin = '';
  bytes.forEach(b => {
    bin += String.fromCharCode(b);
  });
  return btoa(bin);
}

export function decodeBase64Utf8(b64) {
  const norm = String(b64 || '').trim().replace(/-/g, '+').replace(/_/g, '/');
  const padded = norm + '='.repeat((4 - (norm.length % 4)) % 4);
  const bin = atob(padded);
  const bytes = Uint8Array.from(bin, ch => ch.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

export function decodeJwtOffline(token) {
  const parts = String(token || '').trim().split('.');
  if (parts.length < 2) {
    throw new Error('A JWT must have at least 2 dot-separated segments (header.payload.signature).');
  }
  const header = JSON.parse(decodeBase64Utf8(parts[0]));
  const payload = JSON.parse(decodeBase64Utf8(parts[1]));
  const expMs = typeof payload.exp === 'number' ? payload.exp * 1000 : null;
  const expired = expMs !== null ? Date.now() > expMs : null;
  return {
    header,
    payload,
    hasSignature: Boolean(parts[2]),
    expiresAt: expMs ? new Date(expMs).toLocaleString() : null,
    expired,
  };
}

// ---------------- 4. Live Regex Tester ----------------

export function testRegexLive(pattern, flags = 'g', sample = '') {
  if (!pattern) return { valid: true, error: '', matches: [] };
  const safeFlags = [...new Set(String(flags || '').replace(/[^gimsuy]/g, '').split(''))].join('');
  let re;
  try {
    re = new RegExp(pattern, safeFlags);
  } catch (err) {
    return { valid: false, error: err.message, matches: [] };
  }

  const matches = [];
  const text = String(sample || '');
  if (!safeFlags.includes('g')) {
    const m = re.exec(text);
    if (m) matches.push({ match: m[0], index: m.index, groups: m.slice(1) });
    return { valid: true, error: '', matches };
  }

  let m;
  let guard = 0;
  while ((m = re.exec(text)) !== null && guard < 150) {
    guard += 1;
    matches.push({ match: m[0], index: m.index, groups: m.slice(1) });
    if (m[0] === '') re.lastIndex += 1;
  }
  return { valid: true, error: '', matches };
}

// ---------------- 5. Offline Quick IT Cheat Sheets ----------------

export const IT_CHEAT_SHEETS = [
  {
    id: 'git',
    label: 'Git',
    title: 'Git Essentials Cheat Sheet',
    markdown: `## Everyday Workflow
- \`git status\` — inspect modified & staged files
- \`git add -A\` — stage all changes
- \`git commit -m "message"\` — commit staged snapshot
- \`git pull --rebase\` — fetch & replay local commits cleanly
- \`git push origin main\` — push branch to remote

## Branches & Undoing Mistakes
- \`git switch -c feature-x\` — create & switch branch
- \`git merge feature-x\` — merge branch into current
- \`git restore <file>\` — discard unstaged edits in file
- \`git reset --soft HEAD~1\` — undo last commit, keep changes staged
- \`git stash push -m "wip"\` / \`git stash pop\` — shelf work temporarily`,
  },
  {
    id: 'sql',
    label: 'SQL Joins',
    title: 'SQL & Joins Quick Reference',
    markdown: `## Core Query Order
\`SELECT\` → \`FROM\` → \`JOIN\` → \`WHERE\` → \`GROUP BY\` → \`HAVING\` → \`ORDER BY\` → \`LIMIT\`

## Join Types
| Join | Returns |
| --- | --- |
| \`INNER JOIN\` | Only matching rows in both tables |
| \`LEFT JOIN\` | All left rows + matched right rows (NULL if none) |
| \`RIGHT JOIN\` | All right rows + matched left rows |
| \`FULL OUTER JOIN\` | All rows from both tables |

\`\`\`sql
SELECT s.name, COUNT(e.course_id) AS courses
FROM students s
LEFT JOIN enrollments e ON e.student_id = s.id
GROUP BY s.id, s.name
HAVING COUNT(e.course_id) >= 3
ORDER BY courses DESC;
\`\`\``,
  },
  {
    id: 'linux',
    label: 'Linux CLI',
    title: 'Linux & Shell Cheat Sheet',
    markdown: `## Files & Permissions
- \`ls -la\` — list all files with permissions & sizes
- \`chmod 755 script.sh\` — rwxr-xr-x (owner rwx, group/other rx)
- \`chown user:group file\` — change owner/group
- \`find . -name "*.js"\` — locate files by name
- \`grep -rn "TODO" src/\` — recursive line-numbered search

## Processes & Networking
- \`ps aux | grep node\` — inspect running processes
- \`kill -9 <PID>\` — force stop process
- \`ss -tulnp\` — list listening TCP/UDP ports
- \`curl -I https://example.com\` — inspect HTTP response headers`,
  },
  {
    id: 'http',
    label: 'HTTP',
    title: 'HTTP Status Codes Cheat Sheet',
    markdown: `| Code | Meaning | Common Cause |
| --- | --- | --- |
| \`200\` | OK | Request succeeded |
| \`201\` | Created | Resource created (POST) |
| \`204\` | No Content | Succeeded with empty body (DELETE) |
| \`301 / 302\` | Redirect | Moved permanently / temporarily |
| \`400\` | Bad Request | Malformed JSON or validation error |
| \`401\` | Unauthorized | Missing or invalid auth token |
| \`403\` | Forbidden | Authenticated, but lacking permission |
| \`404\` | Not Found | Endpoint or record doesn't exist |
| \`429\` | Too Many Requests | Free-tier API rate limit hit |
| \`500 / 502 / 503\` | Server Error | Backend crash, bad gateway, overloaded |`,
  },
  {
    id: 'bigo',
    label: 'Big-O',
    title: 'Data Structures & Big-O Complexity',
    markdown: `| Structure / Algorithm | Search / Access | Insert / Delete | Notes |
| --- | --- | --- | --- |
| Array | $O(1)$ index / $O(n)$ search | $O(n)$ middle | Contiguous memory |
| Hash Map | $O(1)$ avg / $O(n)$ worst | $O(1)$ avg | Key-value lookups |
| Binary Search | $O(\\log n)$ | — | Requires sorted input |
| Balanced BST | $O(\\log n)$ | $O(\\log n)$ | Keeps sorted order |
| Merge Sort | — | $O(n \\log n)$ | Stable, $O(n)$ space |
| Quick Sort | — | $O(n \\log n)$ avg | In-place, $O(n^2)$ worst |
| BFS / DFS | $O(V + E)$ | — | Graph traversal |`,
  },
];
