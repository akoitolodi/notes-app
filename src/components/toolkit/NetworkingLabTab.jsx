/**
 * NetworkingLabTab — Interactive 100% Offline Hands-On Networking Practical Bench:
 *  1. RJ45 Ethernet Crimping + Animated Dual-LED Cable Tester (Master & Remote)
 *  2. Mini Patch & Ping Simulator (Link LEDs, Straight vs Crossover, Auto-MDIX, Subnet Ping)
 *  3. Interactive Ports & Top-Down Firewall ACL Packet Tester
 */
import { useState, useEffect, useMemo } from 'react';
import { Play, Power, RefreshCw, Shuffle, ArrowUp, ArrowDown, Shield, Cable, Laptop } from 'lucide-react';
import {
  WIRE_COLORS,
  WIRE_BY_ID,
  CABLE_MISSIONS,
  COMMON_PORTS,
  DEFAULT_FIREWALL_RULES,
  evaluateRj45Cable,
  simulatePatchAndPing,
  evaluateFirewallPacket,
} from '../../lib/networkingLab';

function playClickSound() {
  try {
    const AudioCtx = window.AudioContext || window.webkitAudioContext;
    if (!AudioCtx) return;
    const ctx = new AudioCtx();
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(620, ctx.currentTime);
    osc.frequency.exponentialRampToValueAtTime(180, ctx.currentTime + 0.055);
    g.gain.setValueAtTime(0.08, ctx.currentTime);
    g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.06);
    osc.connect(g);
    g.connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + 0.065);
    setTimeout(() => ctx.close().catch(() => {}), 150);
  } catch {
    // Web Audio unavailable
  }
}

export default function NetworkingLabTab() {
  const [bench, setBench] = useState('rj45'); // rj45 | patch | firewall

  // --- Bench 1: RJ45 Crimper & LED Cable Tester ---
  const [missionId, setMissionId] = useState('t568b');
  const [activeEnd, setActiveEnd] = useState('A');
  const [endA, setEndA] = useState([...CABLE_MISSIONS[0].targetA]);
  const [endB, setEndB] = useState([...CABLE_MISSIONS[0].targetB]);
  const [crimped, setCrimped] = useState(false);
  const [testerOn, setTesterOn] = useState(false);
  const [scanPin, setScanPin] = useState(0); // 0..7 active LED index when testerOn
  const [autoScan, setAutoScan] = useState(true);
  const [showHint, setShowHint] = useState(true);
  const [selectedPinIdx, setSelectedPinIdx] = useState(null);

  // --- Bench 2: Patch & Ping Simulator ---
  const [leftDevice, setLeftDevice] = useState('pc1');
  const [rightDevice, setRightDevice] = useState('switch');
  const [patchCableMode, setPatchCableMode] = useState('tested'); // tested | straight | crossover | faulty
  const [autoMdix, setAutoMdix] = useState(false);
  const [leftIp, setLeftIp] = useState('192.168.1.10/24');
  const [rightIp, setRightIp] = useState('192.168.1.20/24');
  const [pingResult, setPingResult] = useState(null);

  // --- Bench 3: Firewall ACL Tester ---
  const [rules, setRules] = useState(DEFAULT_FIREWALL_RULES);
  const [pktProto, setPktProto] = useState('TCP');
  const [pktPort, setPktPort] = useState('443');
  const [pktTrace, setPktTrace] = useState(null);
  const [newRuleAction, setNewRuleAction] = useState('DENY');
  const [newRuleProto, setNewRuleProto] = useState('TCP');
  const [newRulePort, setNewRulePort] = useState('23');

  const mission = CABLE_MISSIONS.find(m => m.id === missionId) || CABLE_MISSIONS[0];
  const cableReport = useMemo(() => evaluateRj45Cable(endA, endB), [endA, endB]);

  // Animated 1..8 LED sweep on Dual Cable Tester
  useEffect(() => {
    if (!testerOn || !crimped || !autoScan) return undefined;
    const id = setInterval(() => {
      setScanPin(p => (p + 1) % 8);
    }, 480);
    return () => clearInterval(id);
  }, [testerOn, crimped, autoScan]);

  const currentPins = activeEnd === 'A' ? endA : endB;
  const setCurrentPins = nextArr => {
    setCrimped(false);
    setTesterOn(false);
    if (activeEnd === 'A') setEndA(nextArr);
    else setEndB(nextArr);
  };

  const loadMission = id => {
    const m = CABLE_MISSIONS.find(x => x.id === id) || CABLE_MISSIONS[0];
    setMissionId(m.id);
    setCrimped(false);
    setTesterOn(false);
    setSelectedPinIdx(null);
    if (m.presetA && m.presetB) {
      // Fault troubleshooting missions pre-wire broken ends ready to crimp/test!
      setEndA([...m.presetA]);
      setEndB([...m.presetB]);
    } else {
      // Practice missions start cleared so student inserts wires (or taps Auto-Wire)
      setEndA(Array(8).fill(null));
      setEndB(Array(8).fill(null));
    }
  };

  const handlePinTap = idx => {
    if (selectedPinIdx === null) {
      setSelectedPinIdx(idx);
      return;
    }
    if (selectedPinIdx === idx) {
      setSelectedPinIdx(null);
      return;
    }
    const copy = [...currentPins];
    const tmp = copy[selectedPinIdx];
    copy[selectedPinIdx] = copy[idx];
    copy[idx] = tmp;
    setCurrentPins(copy);
    setSelectedPinIdx(null);
  };

  const handleWireTap = wireId => {
    const copy = [...currentPins];
    const targetIdx =
      selectedPinIdx !== null ? selectedPinIdx : copy.findIndex(v => v === null);
    if (targetIdx === -1) return;
    // If wire already sits on another pin in this plug, swap cleanly
    const existingIdx = copy.indexOf(wireId);
    if (existingIdx !== -1 && existingIdx !== targetIdx) {
      copy[existingIdx] = copy[targetIdx];
    }
    copy[targetIdx] = wireId;
    setCurrentPins(copy);
    setSelectedPinIdx(null);
  };

  const handleClearPin = (idx, e) => {
    e.stopPropagation();
    const copy = [...currentPins];
    copy[idx] = null;
    setCurrentPins(copy);
    if (selectedPinIdx === idx) setSelectedPinIdx(null);
  };

  const handleAutoWire = () => {
    setCrimped(false);
    setTesterOn(false);
    setSelectedPinIdx(null);
    if (mission.targetA && mission.targetB) {
      setEndA([...mission.targetA]);
      setEndB([...mission.targetB]);
    } else if (mission.presetA && mission.presetB) {
      setEndA([...mission.presetA]);
      setEndB([...mission.presetB]);
    }
  };

  const handleShuffleEnd = () => {
    const shuffled = [...WIRE_COLORS.map(w => w.id)].sort(() => Math.random() - 0.5);
    setCurrentPins(shuffled);
  };

  const handleCrimp = () => {
    playClickSound();
    setCrimped(true);
    setTesterOn(true);
    setScanPin(0);
  };

  // Determine Remote LED state for current scanPin (0..7)
  const mappedRemotePin = cableReport.pinMap[scanPin]; // 1..8 or null
  const activePinClass =
    !testerOn || !crimped
      ? ''
      : mappedRemotePin === null
        ? 'is-red'
        : cableReport.status === 'crossover'
          ? 'is-amber'
          : cableReport.status === 'miswire' || cableReport.status === 'split-pair'
            ? 'is-red'
            : 'is-green';

  const effectivePatchCable =
    patchCableMode === 'tested' ? cableReport.cableType : patchCableMode;

  const patchLive = useMemo(
    () =>
      simulatePatchAndPing({
        leftDevice,
        rightDevice,
        cableType: effectivePatchCable,
        leftIp,
        rightIp,
        autoMdix,
      }),
    [leftDevice, rightDevice, effectivePatchCable, leftIp, rightIp, autoMdix]
  );

  const moveRule = (idx, dir) => {
    const nextIdx = idx + dir;
    if (nextIdx < 0 || nextIdx >= rules.length) return;
    const copy = [...rules];
    const tmp = copy[idx];
    copy[idx] = copy[nextIdx];
    copy[nextIdx] = tmp;
    setRules(copy);
    setPktTrace(null);
  };

  const toggleRuleAction = idx => {
    setRules(rs =>
      rs.map((r, i) => (i === idx ? { ...r, action: r.action === 'ALLOW' ? 'DENY' : 'ALLOW' } : r))
    );
    setPktTrace(null);
  };

  const handleAddRule = () => {
    const pNum = Number(newRulePort);
    if (!Number.isInteger(pNum) || pNum < 1 || pNum > 65535) return;
    setRules(rs => [
      ...rs,
      {
        id: `r-${Date.now().toString(36)}`,
        action: newRuleAction,
        protocol: newRuleProto,
        port: pNum,
        label: `Port ${pNum}`,
      },
    ]);
    setPktTrace(null);
  };

  return (
    <div className="explanation-card">
      <div className="view-switcher view-switcher-inline" style={{ margin: '0 0 12px' }}>
        {[
          ['rj45', 'RJ45 Tester'],
          ['patch', 'Patch & Ping'],
          ['firewall', 'Ports & Firewall'],
        ].map(([id, lbl]) => (
          <button
            key={id}
            type="button"
            className={`view-switch-btn${bench === id ? ' active' : ''}`}
            onClick={() => setBench(id)}
          >
            {lbl}
          </button>
        ))}
      </div>

      {/* ===== BENCH 1: Interactive RJ45 Crimping & Dual LED Cable Tester ===== */}
      {bench === 'rj45' && (
        <>
          <div className="settings-label">Choose Practical Mission</div>
          <div className="mode-picker-row" style={{ marginBottom: 8 }}>
            {CABLE_MISSIONS.map(m => (
              <button
                key={m.id}
                type="button"
                className={`mode-pick-chip${missionId === m.id ? ' active' : ''}`}
                onClick={() => loadMission(m.id)}
              >
                {m.label}
              </button>
            ))}
          </div>

          <div className="settings-tip" style={{ marginBottom: 10 }}>
            {mission.hint}
          </div>

          <div className="flex items-center justify-between gap-8" style={{ flexWrap: 'wrap', marginBottom: 8 }}>
            <div className="feynman-lang-switch" role="group" aria-label="Select Cable End">
              <button
                type="button"
                className={`feynman-lang-btn${activeEnd === 'A' ? ' active' : ''}`}
                onClick={() => {
                  setActiveEnd('A');
                  setSelectedPinIdx(null);
                }}
              >
                End A ({endA.filter(Boolean).length}/8)
              </button>
              <button
                type="button"
                className={`feynman-lang-btn${activeEnd === 'B' ? ' active' : ''}`}
                onClick={() => {
                  setActiveEnd('B');
                  setSelectedPinIdx(null);
                }}
              >
                End B ({endB.filter(Boolean).length}/8)
              </button>
            </div>

            <div className="flex gap-6" style={{ flexWrap: 'wrap' }}>
              <button
                type="button"
                className={`row-action-chip${showHint ? ' active-chip' : ''}`}
                onClick={() => setShowHint(h => !h)}
              >
                Hint: {showHint ? 'ON' : 'OFF'}
              </button>
              <button type="button" className="row-action-chip" onClick={handleAutoWire}>
                Auto-Wire
              </button>
              <button type="button" className="row-action-chip" onClick={handleShuffleEnd}>
                <Shuffle size={12} /> Shuffle
              </button>
              <button
                type="button"
                className="row-action-chip"
                onClick={() => setCurrentPins(Array(8).fill(null))}
              >
                Clear
              </button>
            </div>
          </div>

          {/* Translucent RJ45 Connector Housing */}
          <div className={`rj45-plug${crimped ? ' is-crimped' : ''}`}>
            <div className="rj45-plug-header">
              <span>RJ45 Plug — End {activeEnd} {crimped ? '(CRIMPED)' : '(Open)'}</span>
              <span className="settings-help" style={{ margin: 0 }}>
                {selectedPinIdx !== null ? `Pin ${selectedPinIdx + 1} selected — tap target pin or wire` : 'Tap pin to swap'}
              </span>
            </div>

            <div className="rj45-pins-row">
              {currentPins.map((wireId, idx) => {
                const w = wireId ? WIRE_BY_ID[wireId] : null;
                const targetRef =
                  activeEnd === 'A'
                    ? (mission.targetA || mission.presetA)?.[idx]
                    : (mission.targetB || mission.presetB)?.[idx];
                return (
                  <button
                    key={idx}
                    type="button"
                    className={`rj45-pin${selectedPinIdx === idx ? ' is-selected' : ''}${w ? ' has-wire' : ''}`}
                    onClick={() => handlePinTap(idx)}
                  >
                    <span className="rj45-gold-contact" />
                    <span
                      className="rj45-wire-slot"
                      style={{ background: w ? w.bg : 'transparent' }}
                    />
                    <span className="rj45-pin-num">{idx + 1}</span>
                    <span className="rj45-wire-code">{w ? w.code : '—'}</span>
                    {showHint && targetRef && (
                      <span className="rj45-hint-code">{WIRE_BY_ID[targetRef]?.code}</span>
                    )}
                    {w && (
                      <span
                        role="button"
                        tabIndex={0}
                        aria-label={`Remove wire on Pin ${idx + 1}`}
                        className="rj45-unseat"
                        onClick={e => handleClearPin(idx, e)}
                      >
                        ×
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
          </div>

          {/* 8 Copper Wire Tray */}
          <div className="settings-label mt-10">Tap Wire Color to Insert into Pin</div>
          <div className="wire-tray-grid">
            {WIRE_COLORS.map(w => (
              <button
                key={w.id}
                type="button"
                className="wire-chip"
                onClick={() => handleWireTap(w.id)}
              >
                <span className="wire-swatch" style={{ background: w.bg }} />
                <span>{w.code}</span>
              </button>
            ))}
          </div>

          <div className="flex gap-8 mt-12">
            <button type="button" className="btn btn-primary flex-1" onClick={handleCrimp}>
              <Cable size={15} /> {crimped ? 'Re-Crimp & Test Cable' : 'Crimp Plug & Plug In Tester'}
            </button>
            <button
              type="button"
              className={`btn ${testerOn ? 'btn-secondary' : 'btn-secondary'}`}
              disabled={!crimped}
              onClick={() => setTesterOn(o => !o)}
            >
              <Power size={15} /> {testerOn ? 'Power OFF' : 'Power ON'}
            </button>
          </div>

          {/* Dual Master + Remote LED Cable Tester */}
          <div className="cable-tester-chassis mt-12">
            <div className="flex items-center justify-between gap-8" style={{ marginBottom: 8 }}>
              <span style={{ fontSize: 12, fontWeight: 800 }}>
                Dual LED Cable Tester {testerOn && crimped ? `· Scanning Pin ${scanPin + 1}` : '· Standby'}
              </span>
              {crimped && (
                <div className="flex gap-6">
                  <button
                    type="button"
                    className={`row-action-chip${autoScan ? ' active-chip' : ''}`}
                    onClick={() => setAutoScan(a => !a)}
                  >
                    {autoScan ? 'Auto LED' : 'Manual'}
                  </button>
                  {!autoScan && testerOn && (
                    <button
                      type="button"
                      className="row-action-chip"
                      onClick={() => setScanPin(p => (p + 1) % 8)}
                    >
                      Next Pin
                    </button>
                  )}
                </div>
              )}
            </div>

            <div className="tester-units-grid">
              <div className="tester-unit">
                <div className="tester-unit-title">MASTER (End A)</div>
                <div className="tester-leds-row">
                  {Array.from({ length: 8 }, (_, idx) => {
                    const lit = testerOn && crimped && scanPin === idx;
                    return (
                      <div key={idx} className="tester-led-col">
                        <span className={`tester-led${lit ? ' is-green' : ''}`} />
                        <span>{idx + 1}</span>
                      </div>
                    );
                  })}
                </div>
              </div>

              <div className="tester-unit">
                <div className="tester-unit-title">REMOTE (End B)</div>
                <div className="tester-leds-row">
                  {Array.from({ length: 8 }, (_, idx) => {
                    const lit = testerOn && crimped && mappedRemotePin === idx + 1;
                    return (
                      <div key={idx} className="tester-led-col">
                        <span className={`tester-led${lit ? ` ${activePinClass}` : ''}`} />
                        <span>{idx + 1}</span>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>

            {crimped && (
              <div className={`tester-verdict mt-10 ${cableReport.ok ? 'is-pass' : 'is-fail'}`}>
                <div style={{ fontWeight: 800, fontSize: 13 }}>{cableReport.badge}</div>
                <div style={{ fontSize: 12, marginTop: 3 }}>{cableReport.detail}</div>
                <div className="mt-8">
                  <button
                    type="button"
                    className="row-action-chip active-chip"
                    onClick={() => {
                      setPatchCableMode('tested');
                      setPingResult(null);
                      setBench('patch');
                    }}
                  >
                    Use Tested Cable in Patch &amp; Ping →
                  </button>
                </div>
              </div>
            )}
          </div>
        </>
      )}

      {/* ===== BENCH 2: Patch & Ping Link Simulator ===== */}
      {bench === 'patch' && (
        <>
          <div className="patch-devices-row">
            <div className="patch-device-box">
              <div className="settings-label" style={{ marginBottom: 4 }}>Left Port</div>
              <select
                className="input-field"
                value={leftDevice}
                onChange={e => {
                  setLeftDevice(e.target.value);
                  setPingResult(null);
                }}
              >
                <option value="pc1">PC 1</option>
                <option value="switch">Switch 1</option>
              </select>
              <div className="patch-link-indicator">
                <span className={`tester-led ${patchLive.linkUp ? 'is-green' : ''}`} />
                <span>{patchLive.linkUp ? 'Link UP' : 'No Link'}</span>
              </div>
            </div>

            <div className="patch-device-box">
              <div className="settings-label" style={{ marginBottom: 4 }}>Right Port</div>
              <select
                className="input-field"
                value={rightDevice}
                onChange={e => {
                  setRightDevice(e.target.value);
                  setPingResult(null);
                }}
              >
                <option value="switch">Switch 1</option>
                <option value="pc2">PC 2</option>
                <option value="router">Router</option>
              </select>
              <div className="patch-link-indicator">
                <span className={`tester-led ${patchLive.linkUp ? 'is-green' : ''}`} />
                <span>{patchLive.linkUp ? 'Link UP' : 'No Link'}</span>
              </div>
            </div>
          </div>

          <div className="settings-label mt-10">Cable Connected</div>
          <div className="mode-picker-row" style={{ marginBottom: 8 }}>
            {[
              ['tested', `Your Cable (${cableReport.cableType})`],
              ['straight', 'Known Straight'],
              ['crossover', 'Known Crossover'],
              ['faulty', 'Faulty Cable'],
            ].map(([id, lbl]) => (
              <button
                key={id}
                type="button"
                className={`mode-pick-chip${patchCableMode === id ? ' active' : ''}`}
                onClick={() => {
                  setPatchCableMode(id);
                  setPingResult(null);
                }}
              >
                {lbl}
              </button>
            ))}
          </div>

          <div className="flex items-center justify-between gap-8" style={{ marginBottom: 10 }}>
            <button
              type="button"
              className={`row-action-chip${autoMdix ? ' active-chip' : ''}`}
              onClick={() => setAutoMdix(a => !a)}
            >
              Auto-MDIX: {autoMdix ? 'ON' : 'OFF (Legacy Switch)'}
            </button>
            <span className="settings-help" style={{ margin: 0 }}>{patchLive.linkReason}</span>
          </div>

          <div className="patch-devices-row">
            <div>
              <div className="settings-label">Left IP / CIDR</div>
              <input
                type="text"
                className="ai-input"
                value={leftIp}
                onChange={e => setLeftIp(e.target.value)}
                spellCheck="false"
              />
            </div>
            <div>
              <div className="settings-label">Right IP / CIDR</div>
              <input
                type="text"
                className="ai-input"
                value={rightIp}
                onChange={e => setRightIp(e.target.value)}
                spellCheck="false"
              />
            </div>
          </div>

          <button
            type="button"
            className="btn btn-primary w-full mt-12"
            onClick={() => setPingResult(patchLive)}
          >
            <Laptop size={15} /> Send Ping Packet
          </button>

          {pingResult && (
            <pre className="smart-output-pre mt-10" style={{ padding: 10, borderRadius: 10, background: 'var(--surface-2)' }}>
              {pingResult.output}
            </pre>
          )}
        </>
      )}

      {/* ===== BENCH 3: Ports & Top-Down Firewall ACL Simulator ===== */}
      {bench === 'firewall' && (
        <>
          <div className="settings-label">1. Craft Test Packet</div>
          <div className="flex gap-8" style={{ marginBottom: 8 }}>
            <select
              className="input-field"
              style={{ width: 92, margin: 0 }}
              value={pktProto}
              onChange={e => {
                setPktProto(e.target.value);
                setPktTrace(null);
              }}
            >
              <option value="TCP">TCP</option>
              <option value="UDP">UDP</option>
            </select>
            <input
              type="number"
              className="input-field flex-1"
              style={{ margin: 0 }}
              value={pktPort}
              onChange={e => {
                setPktPort(e.target.value);
                setPktTrace(null);
              }}
              placeholder="Port #"
            />
            <button
              type="button"
              className="btn btn-primary btn-sm"
              onClick={() => setPktTrace(evaluateFirewallPacket({ protocol: pktProto, port: pktPort }, rules))}
            >
              <Play size={14} /> Send
            </button>
          </div>

          <div className="flex gap-6" style={{ flexWrap: 'wrap', marginBottom: 12 }}>
            {COMMON_PORTS.map(cp => (
              <button
                key={cp.port}
                type="button"
                className="tag-pill"
                style={{ cursor: 'pointer' }}
                onClick={() => {
                  setPktProto(cp.protocol);
                  setPktPort(String(cp.port));
                  setPktTrace(null);
                }}
              >
                {cp.service} ({cp.port}/{cp.protocol})
              </button>
            ))}
          </div>

          {pktTrace && (
            <div className={`tester-verdict ${pktTrace.decision === 'ALLOW' ? 'is-pass' : 'is-fail'}`} style={{ marginBottom: 12 }}>
              <div className="flex items-center gap-6" style={{ fontWeight: 800, fontSize: 13 }}>
                <Shield size={14} /> {pktTrace.decision}
              </div>
              <div style={{ fontSize: 12, marginTop: 3 }}>{pktTrace.reason}</div>
            </div>
          )}

          <div className="flex items-center justify-between gap-8" style={{ marginBottom: 6 }}>
            <span className="settings-label" style={{ margin: 0 }}>2. Top-Down Firewall Rules (First Match Wins)</span>
            <button
              type="button"
              className="row-action-chip"
              onClick={() => {
                setRules(DEFAULT_FIREWALL_RULES);
                setPktTrace(null);
              }}
            >
              <RefreshCw size={11} /> Reset
            </button>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {rules.map((r, idx) => {
              const isMatched = pktTrace && pktTrace.matchedRuleIndex === idx;
              return (
                <div
                  key={r.id}
                  className={`fw-rule-row${isMatched ? (r.action === 'ALLOW' ? ' is-allow' : ' is-deny') : ''}`}
                >
                  <button
                    type="button"
                    className={`row-action-chip${r.action === 'ALLOW' ? ' active-chip' : ''}`}
                    onClick={() => toggleRuleAction(idx)}
                  >
                    {r.action}
                  </button>
                  <div style={{ flex: 1, minWidth: 0, fontSize: 12.5 }}>
                    <strong>#{idx + 1} {r.protocol}:{r.port}</strong>{' '}
                    <span className="settings-help" style={{ margin: 0 }}>{r.label}</span>
                  </div>
                  <div className="flex gap-4">
                    <button
                      type="button"
                      className="icon-btn"
                      aria-label="Move rule up"
                      onClick={() => moveRule(idx, -1)}
                    >
                      <ArrowUp size={13} />
                    </button>
                    <button
                      type="button"
                      className="icon-btn"
                      aria-label="Move rule down"
                      onClick={() => moveRule(idx, 1)}
                    >
                      <ArrowDown size={13} />
                    </button>
                  </div>
                </div>
              );
            })}
            <div className="fw-rule-row" style={{ opacity: 0.72 }}>
              <span className="row-action-chip">DENY</span>
              <span style={{ fontSize: 12 }}>Implicit Default Deny ANY (Bottom)</span>
            </div>
          </div>

          <div className="flex gap-6 mt-10" style={{ flexWrap: 'wrap' }}>
            <select
              className="input-field"
              style={{ width: 92, margin: 0 }}
              value={newRuleAction}
              onChange={e => setNewRuleAction(e.target.value)}
            >
              <option value="ALLOW">ALLOW</option>
              <option value="DENY">DENY</option>
            </select>
            <select
              className="input-field"
              style={{ width: 82, margin: 0 }}
              value={newRuleProto}
              onChange={e => setNewRuleProto(e.target.value)}
            >
              <option value="TCP">TCP</option>
              <option value="UDP">UDP</option>
              <option value="ANY">ANY</option>
            </select>
            <input
              type="number"
              className="input-field"
              style={{ width: 86, margin: 0 }}
              value={newRulePort}
              onChange={e => setNewRulePort(e.target.value)}
              placeholder="Port"
            />
            <button type="button" className="btn btn-secondary btn-sm" onClick={handleAddRule}>
              + Add Rule
            </button>
          </div>
        </>
      )}
    </div>
  );
}
