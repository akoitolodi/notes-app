/**
 * networkingLab — 100% offline Interactive Networking Practical Simulator:
 * 1. RJ45 T568A / T568B / Crossover Crimping & Dual LED Cable Tester
 * 2. Patch & Ping Link Simulator (Straight vs Crossover, Auto-MDIX, Subnet ICMP check)
 * 3. Top-Down Ports & Firewall ACL Packet Tester
 */
import { calculateSubnet } from './itTools';

export const WIRE_COLORS = [
  { id: 'WO', code: 'W/O', name: 'White/Orange', stripe: true, primary: '#f97316', bg: 'repeating-linear-gradient(135deg,#fff 0 4px,#f97316 4px 8px)' },
  { id: 'O', code: 'O', name: 'Orange', stripe: false, primary: '#f97316', bg: '#f97316' },
  { id: 'WG', code: 'W/G', name: 'White/Green', stripe: true, primary: '#22c55e', bg: 'repeating-linear-gradient(135deg,#fff 0 4px,#22c55e 4px 8px)' },
  { id: 'B', code: 'B', name: 'Blue', stripe: false, primary: '#2563eb', bg: '#2563eb' },
  { id: 'WB', code: 'W/B', name: 'White/Blue', stripe: true, primary: '#2563eb', bg: 'repeating-linear-gradient(135deg,#fff 0 4px,#2563eb 4px 8px)' },
  { id: 'G', code: 'G', name: 'Green', stripe: false, primary: '#22c55e', bg: '#22c55e' },
  { id: 'WBr', code: 'W/Br', name: 'White/Brown', stripe: true, primary: '#92400e', bg: 'repeating-linear-gradient(135deg,#fff 0 4px,#92400e 4px 8px)' },
  { id: 'Br', code: 'Br', name: 'Brown', stripe: false, primary: '#92400e', bg: '#92400e' },
];

export const WIRE_BY_ID = Object.fromEntries(WIRE_COLORS.map(w => [w.id, w]));

// EIA/TIA-568 Pinout Standards (Pins 1..8)
export const T568B = ['WO', 'O', 'WG', 'B', 'WB', 'G', 'WBr', 'Br'];
export const T568A = ['WG', 'G', 'WO', 'B', 'WB', 'O', 'WBr', 'Br'];

export const CABLE_MISSIONS = [
  {
    id: 't568b',
    label: 'T568B Straight',
    hint: 'PC <-> Switch or Switch <-> Router. Both ends match T568B (1-W/O, 2-O, 3-W/G, 4-B, 5-W/B, 6-G, 7-W/Br, 8-Br).',
    targetA: [...T568B],
    targetB: [...T568B],
  },
  {
    id: 't568a',
    label: 'T568A Straight',
    hint: 'Both ends match T568A (1-W/G, 2-G, 3-W/O, 4-B, 5-W/B, 6-O, 7-W/Br, 8-Br).',
    targetA: [...T568A],
    targetB: [...T568A],
  },
  {
    id: 'crossover',
    label: 'Crossover (A <-> B)',
    hint: 'PC <-> PC or Switch <-> Switch (no Auto-MDIX). End A uses T568A, End B uses T568B (swaps 1<->3 and 2<->6).',
    targetA: [...T568A],
    targetB: [...T568B],
  },
  {
    id: 'fault-open',
    label: 'Fault Lab: Open Pin',
    hint: 'A bad crimp left Pin 3 unseated on End B! Find the dark LED on the tester and reseat it.',
    presetA: [...T568B],
    presetB: ['WO', 'O', null, 'B', 'WB', 'G', 'WBr', 'Br'],
  },
  {
    id: 'fault-miswire',
    label: 'Fault Lab: Crossed Pins',
    hint: 'Two wires were swapped accidentally on End B! Power on the tester to spot which pins cross.',
    presetA: [...T568B],
    presetB: ['WO', 'O', 'WG', 'WB', 'B', 'G', 'WBr', 'Br'],
  },
  {
    id: 'fault-split',
    label: 'Fault Lab: Split Pair',
    hint: 'Pins 3 and 4 look straight-through on continuity, but splitting the Green/Blue twisted pairs causes severe crosstalk!',
    presetA: ['WO', 'O', 'B', 'WG', 'WB', 'G', 'WBr', 'Br'],
    presetB: ['WO', 'O', 'B', 'WG', 'WB', 'G', 'WBr', 'Br'],
  },
];

function arrEq(a, b) {
  return Array.isArray(a) && Array.isArray(b) && a.length === 8 && a.every((v, i) => v === b[i]);
}

/**
 * Evaluate two 8-pin RJ45 cable ends just like a real Dual LED Ethernet Cable Tester.
 */
export function evaluateRj45Cable(endA = [], endB = []) {
  const a = Array.from({ length: 8 }, (_, i) => endA[i] || null);
  const b = Array.from({ length: 8 }, (_, i) => endB[i] || null);

  // Check duplicate wires on same end
  const countMap = arr => {
    const m = new Map();
    arr.forEach((w, idx) => {
      if (!w) return;
      if (!m.has(w)) m.set(w, []);
      m.get(w).push(idx + 1);
    });
    return m;
  };
  const mapB = countMap(b);

  const pinMap = []; // 1-based remote pin per master pin (or null)
  const openPins = [];
  const miswiredPins = [];

  for (let i = 0; i < 8; i++) {
    const wire = a[i];
    if (!wire) {
      pinMap.push(null);
      openPins.push(i + 1);
      continue;
    }
    const remotePins = mapB.get(wire) || [];
    if (remotePins.length === 0) {
      pinMap.push(null);
      openPins.push(i + 1);
    } else {
      const rPin = remotePins[0];
      pinMap.push(rPin);
      if (rPin !== i + 1) {
        miswiredPins.push({ from: i + 1, to: rPin, wire });
      }
    }
  }

  // Also flag open wires present on B missing on A
  for (let i = 0; i < 8; i++) {
    if (b[i] === null && !openPins.includes(i + 1)) {
      openPins.push(i + 1);
    }
  }

  if (openPins.length > 0) {
    return {
      ok: false,
      status: 'open',
      badge: 'FAIL — Open / Unseated Pin',
      detail: `No continuity on Pin(s) ${[...new Set(openPins)].sort((x, y) => x - y).join(', ')}. Reseat wire fully before crimping.`,
      pinMap,
      issues: openPins,
      isSplitPair: false,
      cableType: 'faulty',
    };
  }

  // Valid Crossover check (one end T568A, other end T568B)
  const isCrossover = (arrEq(a, T568A) && arrEq(b, T568B)) || (arrEq(a, T568B) && arrEq(b, T568A));
  if (isCrossover) {
    return {
      ok: true,
      status: 'crossover',
      badge: 'PASS — Valid Crossover Cable',
      detail: 'T568A <-> T568B verified! TX/RX pairs (1<->3, 2<->6) crossed cleanly for PC-to-PC or Switch-to-Switch links.',
      pinMap,
      issues: [],
      isSplitPair: false,
      cableType: 'crossover',
    };
  }

  // Miswired pins (non-crossover non-1:1)
  if (miswiredPins.length > 0) {
    const pairsStr = miswiredPins.map(m => `${m.from}→${m.to}`).join(', ');
    return {
      ok: false,
      status: 'miswire',
      badge: 'FAIL — Miswired / Crossed Pins',
      detail: `Pin mismatch detected (${pairsStr}). Order on both ends must match T568A/B or form a proper Crossover.`,
      pinMap,
      issues: miswiredPins,
      isSplitPair: false,
      cableType: 'faulty',
    };
  }

  // All pins 1..8 match 1:1 — verify twisted pair grouping (1&2 pair, 3&6 pair, 4&5 pair, 7&8 pair)
  if (arrEq(a, T568B) && arrEq(b, T568B)) {
    return {
      ok: true,
      status: 'straight-t568b',
      badge: 'PASS — T568B Straight-Through',
      detail: 'Pins 1–8 matched 1:1 under TIA/EIA-568B. Gigabit 1000BASE-T ready!',
      pinMap,
      issues: [],
      isSplitPair: false,
      cableType: 'straight',
    };
  }

  if (arrEq(a, T568A) && arrEq(b, T568A)) {
    return {
      ok: true,
      status: 'straight-t568a',
      badge: 'PASS — T568A Straight-Through',
      detail: 'Pins 1–8 matched 1:1 under TIA/EIA-568A. Gigabit 1000BASE-T ready!',
      pinMap,
      issues: [],
      isSplitPair: false,
      cableType: 'straight',
    };
  }

  // Check split-pair: pins 1-2 must share same color family, 3-6, 4-5, 7-8
  const family = id => String(id || '').replace(/^W/, '');
  const validPairGrouping =
    family(a[0]) === family(a[1]) &&
    family(a[2]) === family(a[5]) &&
    family(a[3]) === family(a[4]) &&
    family(a[6]) === family(a[7]);

  return {
    ok: false,
    status: validPairGrouping ? 'straight-nonstandard' : 'split-pair',
    badge: validPairGrouping ? 'WARN — Custom Pinout (Non-Standard)' : 'WARN — Split Pair Crosstalk!',
    detail: validPairGrouping
      ? 'Continuity 1:1 passes, but wires do not follow T568A/T568B color order.'
      : 'Continuity LEDs light 1–8, BUT twisted pairs are split across TX/RX pins (3 & 6 or 1 & 2). Real cables suffer severe crosstalk & packet loss!',
    pinMap,
    issues: [],
    isSplitPair: !validPairGrouping,
    cableType: validPairGrouping ? 'straight' : 'faulty',
  };
}

/** 2. Patch & Ping Link Simulator */
function isLikeDevicePair(leftDevice, rightDevice) {
  const layer = d => (d === 'switch' || d === 'hub' ? 'dce' : 'dte'); // PC & Router = DTE, Switch = DCE
  return layer(leftDevice) === layer(rightDevice);
}

export function simulatePatchAndPing({
  leftDevice = 'pc1',
  rightDevice = 'switch',
  cableType = 'straight', // 'straight' | 'crossover' | 'faulty'
  leftIp = '192.168.1.10/24',
  rightIp = '192.168.1.20/24',
  autoMdix = false,
}) {
  const needsCrossover = isLikeDevicePair(leftDevice, rightDevice);
  const expectedCable = needsCrossover ? 'crossover' : 'straight';

  let linkUp = false;
  let linkReason = '';
  if (cableType === 'faulty') {
    linkUp = false;
    linkReason = 'Cable has open/miswired/split-pair fault. Fix your RJ45 crimp first.';
  } else if (cableType === expectedCable || autoMdix) {
    linkUp = true;
    linkReason =
      cableType === expectedCable
        ? `Layer 1 Link UP (${cableType} cable matches ${leftDevice.toUpperCase()} <-> ${rightDevice.toUpperCase()}).`
        : `Layer 1 Link UP via Auto-MDIX (auto-corrected ${cableType} cable).`;
  } else {
    linkUp = false;
    linkReason = `No Carrier! Like-to-like (${leftDevice.toUpperCase()} <-> ${rightDevice.toUpperCase()}) needs a ${expectedCable.toUpperCase()} cable (or enable Auto-MDIX).`;
  }

  let sameSubnet = false;
  let subnetDetail = '';
  let targetIpOnly = rightIp;
  try {
    const s1 = calculateSubnet(leftIp);
    const s2 = calculateSubnet(rightIp);
    targetIpOnly = s2.ip;
    sameSubnet = s1.cidr === s2.cidr;
    subnetDetail = sameSubnet
      ? `Same IPv4 network (${s1.cidr})`
      : `Subnet mismatch: ${s1.cidr} vs ${s2.cidr}`;
  } catch (err) {
    subnetDetail = err.message;
  }

  const pingSuccess = linkUp && sameSubnet;
  const outputLines = !linkUp
    ? [
        `Pinging ${targetIpOnly} with 32 bytes of data:`,
        `PING: transmit failed. General failure (Link LED OFF — ${linkReason})`,
      ]
    : !sameSubnet
      ? [
          `Pinging ${targetIpOnly} with 32 bytes of data:`,
          `Reply from ${leftIp.split('/')[0]}: Destination host unreachable.`,
          `(${subnetDetail})`,
        ]
      : [
          `Pinging ${targetIpOnly} with 32 bytes of data:`,
          `Reply from ${targetIpOnly}: bytes=32 time<1ms TTL=128`,
          `Reply from ${targetIpOnly}: bytes=32 time<1ms TTL=128`,
          `Packets: Sent = 2, Received = 2, Lost = 0 (0% loss)`,
        ];

  return {
    linkUp,
    expectedCable,
    sameSubnet,
    pingSuccess,
    linkReason,
    subnetDetail,
    output: outputLines.join('\n'),
  };
}

/** 3. Interactive Ports & Top-Down Firewall ACL Simulator */
export const COMMON_PORTS = [
  { port: 22, protocol: 'TCP', service: 'SSH', desc: 'Encrypted remote shell' },
  { port: 53, protocol: 'UDP', service: 'DNS', desc: 'Domain name resolution' },
  { port: 80, protocol: 'TCP', service: 'HTTP', desc: 'Unencrypted web traffic' },
  { port: 443, protocol: 'TCP', service: 'HTTPS', desc: 'TLS encrypted web traffic' },
  { port: 21, protocol: 'TCP', service: 'FTP', desc: 'Unencrypted file transfer' },
  { port: 3306, protocol: 'TCP', service: 'MySQL', desc: 'Database server port' },
  { port: 3389, protocol: 'TCP', service: 'RDP', desc: 'Windows Remote Desktop' },
];

export const DEFAULT_FIREWALL_RULES = [
  { id: 'r1', action: 'ALLOW', protocol: 'TCP', port: 443, label: 'Allow HTTPS Web' },
  { id: 'r2', action: 'DENY', protocol: 'TCP', port: 21, label: 'Block Insecure FTP' },
  { id: 'r3', action: 'ALLOW', protocol: 'TCP', port: 22, label: 'Allow SSH Admin' },
  { id: 'r4', action: 'ALLOW', protocol: 'UDP', port: 53, label: 'Allow DNS Lookups' },
];

export function evaluateFirewallPacket(packet, rules = []) {
  const proto = String(packet?.protocol || 'TCP').toUpperCase();
  const portNum = Number(packet?.port);
  const trace = [];

  for (let idx = 0; idx < rules.length; idx++) {
    const r = rules[idx];
    const rProto = String(r.protocol || 'ANY').toUpperCase();
    const protoMatch = rProto === 'ANY' || rProto === proto;
    const portMatch = r.port === 'ANY' || r.port === '*' || Number(r.port) === portNum;
    const matched = protoMatch && portMatch;
    trace.push({
      index: idx,
      rule: r,
      matched,
    });
    if (matched) {
      return {
        decision: r.action === 'ALLOW' ? 'ALLOW' : 'DENY',
        matchedRuleIndex: idx,
        matchedRule: r,
        reason: `Matched Rule #${idx + 1} (${r.action} ${r.protocol}:${r.port} — ${r.label || 'Custom Rule'})`,
        trace,
      };
    }
  }

  return {
    decision: 'DENY',
    matchedRuleIndex: -1,
    matchedRule: null,
    reason: `No rule matched ${proto}:${portNum} → Dropped by Implicit Default DENY ANY`,
    trace,
  };
}
