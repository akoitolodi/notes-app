/**
 * DevToolkitScreen — Dedicated, separate, 100% offline Dev & IT Toolkit add-on.
 * Toggleable in Settings → Optional Add-ons (never clutters general notes).
 */
import { useState } from 'react';
import {
  ChevronLeft,
  Copy,
  FilePlus2,
  Network,
  Binary,
  Braces,
  Regex,
  BookOpen,
} from 'lucide-react';
import {
  calculateSubnet,
  convertNumberBase,
  computeBitwise,
  formatJsonSafe,
  encodeBase64Utf8,
  decodeBase64Utf8,
  decodeJwtOffline,
  testRegexLive,
  IT_CHEAT_SHEETS,
} from '../lib/itTools';
import { db, createNote } from '../store/db';
import MarkdownContent from './ui/MarkdownContent';
import { useDialog } from './ui/DialogProvider';

export default function DevToolkitScreen({ onBack, onOpenNote }) {
  const { toast } = useDialog();
  const [tab, setTab] = useState('subnet'); // subnet | base | json | regex | sheets

  // Subnet state
  const [cidr, setCidr] = useState('192.168.10.42/26');

  // Base & bitwise state
  const [baseInput, setBaseInput] = useState('255');
  const [fromBase, setFromBase] = useState(10);
  const [bitA, setBitA] = useState('12');
  const [bitB, setBitB] = useState('10');
  const [bitOp, setBitOp] = useState('AND');

  // JSON / Base64 / JWT state
  const [codecMode, setCodecMode] = useState('json'); // json | base64 | url | jwt
  const [codecInput, setCodecInput] = useState('{"course":"BSIT","offline":true,"tools":["subnet","regex"]}');

  // Regex state
  const [regexPat, setRegexPat] = useState('\\b[A-Z][a-z]+\\b');
  const [regexFlags, setRegexFlags] = useState('g');
  const [regexSample, setRegexSample] = useState('Notes by Bai works offline on Android and Desktop.');

  // Cheat sheets state
  const [sheetId, setSheetId] = useState(IT_CHEAT_SHEETS[0].id);

  const copyVal = async text => {
    try {
      await navigator.clipboard.writeText(String(text || ''));
      toast('Copied to clipboard');
    } catch {
      toast('Copy failed', { type: 'error' });
    }
  };

  const saveAsNote = async (title, markdown) => {
    const folders = await db.folders.toArray();
    const target = folders.find(f => !f.locked && f.mode === 'code') || folders.find(f => !f.locked) || folders[0];
    const created = await createNote(target?.id ?? null, title, markdown, target?.name || 'General');
    toast(`Saved "${title}" as a note`, { type: 'success' });
    onOpenNote?.(created, target || { id: '__all__', name: 'All Notes' });
  };

  // Compute derived results safely
  let subnetRes = null;
  let subnetErr = '';
  try {
    subnetRes = calculateSubnet(cidr);
  } catch (e) {
    subnetErr = e.message;
  }

  let baseRes = null;
  let baseErr = '';
  try {
    baseRes = convertNumberBase(baseInput, fromBase);
  } catch (e) {
    baseErr = e.message;
  }

  let bitRes = null;
  try {
    bitRes = computeBitwise(bitA, bitB, bitOp);
  } catch {
    bitRes = null;
  }

  const regexRes = testRegexLive(regexPat, regexFlags, regexSample);
  const activeSheet = IT_CHEAT_SHEETS.find(s => s.id === sheetId) || IT_CHEAT_SHEETS[0];

  return (
    <div className="screen">
      <header className="navbar">
        <button type="button" className="navbar-btn navbar-back" onClick={onBack}>
          <ChevronLeft size={20} /> Folders
        </button>
        <span className="navbar-title">Dev &amp; IT Toolkit</span>
        <span style={{ width: 54 }} />
      </header>

      <div className="large-title">IT Toolkit</div>

      <div className="view-switcher">
        {[
          ['subnet', 'Subnet', Network],
          ['base', 'Bases', Binary],
          ['json', 'JSON/JWT', Braces],
          ['regex', 'Regex', Regex],
          ['sheets', 'Sheets', BookOpen],
        ].map(([id, label]) => (
          <button
            key={id}
            type="button"
            className={`view-switch-btn${tab === id ? ' active' : ''}`}
            onClick={() => setTab(id)}
          >
            {label}
          </button>
        ))}
      </div>

      <div className="editor">
        {/* 1. IPv4 / CIDR Subnet Calculator */}
        {tab === 'subnet' && (
          <div className="explanation-card">
            <div className="settings-label">IPv4 Address / CIDR Prefix</div>
            <input
              type="text"
              className="ai-input"
              value={cidr}
              onChange={e => setCidr(e.target.value)}
              placeholder="e.g. 192.168.10.42/26"
              spellCheck="false"
            />
            <div className="flex gap-6 mt-8" style={{ flexWrap: 'wrap' }}>
              {['192.168.1.10/24', '192.168.10.42/26', '172.16.4.1/22', '10.0.0.1/30'].map(ex => (
                <button
                  key={ex}
                  type="button"
                  className="tag-pill"
                  style={{ cursor: 'pointer' }}
                  onClick={() => setCidr(ex)}
                >
                  {ex}
                </button>
              ))}
            </div>

            {subnetErr && <div className="inline-mistake mt-12">{subnetErr}</div>}

            {subnetRes && (
              <>
                <div className="subnet-grid mt-12">
                  {[
                    ['Network ID', subnetRes.cidr],
                    ['Broadcast', subnetRes.broadcastAddress],
                    ['First Usable', subnetRes.firstUsable],
                    ['Last Usable', subnetRes.lastUsable],
                    ['Usable Hosts', subnetRes.usableHosts.toLocaleString()],
                    ['Subnet Mask', subnetRes.subnetMask],
                    ['Wildcard Mask', subnetRes.wildcardMask],
                    ['Class / Scope', `${subnetRes.ipClass} · ${subnetRes.scope}`],
                  ].map(([k, v]) => (
                    <div key={k} className="subnet-cell">
                      <div className="subnet-k">{k}</div>
                      <div className="subnet-v">{v}</div>
                    </div>
                  ))}
                </div>

                <div className="settings-label mt-12">Binary Breakdown</div>
                <pre className="md-pre" style={{ fontSize: 12 }}>
                  <code>{`IP:   ${subnetRes.binaryIp}\nMask: ${subnetRes.binaryMask}\nNet:  ${subnetRes.binaryNetwork}`}</code>
                </pre>

                <div className="flex gap-8 mt-12">
                  <button
                    type="button"
                    className="btn btn-secondary btn-sm flex-1"
                    onClick={() =>
                      copyVal(
                        `CIDR: ${subnetRes.cidr}\nMask: ${subnetRes.subnetMask}\nRange: ${subnetRes.firstUsable} - ${subnetRes.lastUsable}\nBroadcast: ${subnetRes.broadcastAddress}\nUsable Hosts: ${subnetRes.usableHosts}`
                      )
                    }
                  >
                    <Copy size={14} /> Copy Summary
                  </button>
                  <button
                    type="button"
                    className="btn btn-primary btn-sm flex-1"
                    onClick={() =>
                      saveAsNote(
                        `Subnet ${subnetRes.cidr}`,
                        `## Subnet Calculation: \`${subnetRes.ip}/${subnetRes.prefix}\`\n| Property | Value |\n| --- | --- |\n| Network ID | \`${subnetRes.cidr}\` |\n| Subnet Mask | \`${subnetRes.subnetMask}\` |\n| Wildcard Mask | \`${subnetRes.wildcardMask}\` |\n| Usable Host Range | \`${subnetRes.firstUsable}\` – \`${subnetRes.lastUsable}\` |\n| Broadcast | \`${subnetRes.broadcastAddress}\` |\n| Usable Hosts | ${subnetRes.usableHosts.toLocaleString()} |\n\n#networking #subnetting`
                      )
                    }
                  >
                    <FilePlus2 size={14} /> Save as Note
                  </button>
                </div>
              </>
            )}
          </div>
        )}

        {/* 2. Number Base & Bitwise Converter */}
        {tab === 'base' && (
          <>
            <div className="explanation-card">
              <div className="settings-label">Input Base</div>
              <div className="mode-picker-row" style={{ marginBottom: 10 }}>
                {[
                  [2, 'BIN (2)'],
                  [8, 'OCT (8)'],
                  [10, 'DEC (10)'],
                  [16, 'HEX (16)'],
                ].map(([b, lbl]) => (
                  <button
                    key={b}
                    type="button"
                    className={`mode-pick-chip${fromBase === b ? ' active' : ''}`}
                    onClick={() => setFromBase(b)}
                  >
                    {lbl}
                  </button>
                ))}
              </div>
              <input
                type="text"
                className="ai-input"
                value={baseInput}
                onChange={e => setBaseInput(e.target.value)}
                placeholder="Enter number…"
                spellCheck="false"
              />
              {baseErr && <div className="inline-mistake mt-8">{baseErr}</div>}
              {baseRes && !baseErr && (
                <div className="subnet-grid mt-12">
                  {[
                    ['Decimal (10)', baseRes.dec],
                    ['Hexadecimal (16)', `0x${baseRes.hex}`],
                    ['Binary (2)', baseRes.bin],
                    ['Octal (8)', `0o${baseRes.oct}`],
                  ].map(([k, v]) => (
                    <button
                      key={k}
                      type="button"
                      className="subnet-cell"
                      style={{ textAlign: 'left', cursor: 'pointer' }}
                      onClick={() => copyVal(v)}
                      title="Tap to copy"
                    >
                      <div className="subnet-k">{k}</div>
                      <div className="subnet-v" style={{ wordBreak: 'break-all' }}>{v || '—'}</div>
                    </button>
                  ))}
                </div>
              )}
            </div>

            <div className="explanation-card">
              <div className="settings-label">Bitwise Operations (Decimal Inputs)</div>
              <div className="flex gap-8 items-center">
                <input
                  type="number"
                  className="ai-input flex-1"
                  value={bitA}
                  onChange={e => setBitA(e.target.value)}
                  aria-label="Operand A"
                />
                <select
                  className="dictation-lang"
                  value={bitOp}
                  onChange={e => setBitOp(e.target.value)}
                  aria-label="Bitwise operator"
                >
                  {['AND', 'OR', 'XOR', 'SHL', 'SHR'].map(op => (
                    <option key={op} value={op}>{op}</option>
                  ))}
                </select>
                <input
                  type="number"
                  className="ai-input flex-1"
                  value={bitB}
                  onChange={e => setBitB(e.target.value)}
                  aria-label="Operand B"
                />
              </div>
              {bitRes && (
                <div className="mt-12" style={{ fontSize: 13.5, fontFamily: 'var(--font-mono)' }}>
                  DEC: <strong>{bitRes.dec}</strong> · HEX: <strong>0x{bitRes.hex}</strong> · BIN: <strong>{bitRes.bin}</strong>
                </div>
              )}
            </div>
          </>
        )}

        {/* 3. JSON / Base64 / URL / Offline JWT Inspector */}
        {tab === 'json' && (
          <div className="explanation-card">
            <div className="mode-picker-row" style={{ marginBottom: 10 }}>
              {[
                ['json', 'JSON'],
                ['jwt', 'JWT Decode'],
                ['base64', 'Base64'],
                ['url', 'URL'],
              ].map(([m, lbl]) => (
                <button
                  key={m}
                  type="button"
                  className={`mode-pick-chip${codecMode === m ? ' active' : ''}`}
                  onClick={() => setCodecMode(m)}
                >
                  {lbl}
                </button>
              ))}
            </div>

            <textarea
              className="ai-input"
              rows={5}
              value={codecInput}
              onChange={e => setCodecInput(e.target.value)}
              placeholder={
                codecMode === 'json'
                  ? 'Paste JSON to validate & format…'
                  : codecMode === 'jwt'
                    ? 'Paste a JWT token (decoded 100% offline)…'
                    : 'Enter text to encode or decode…'
              }
              spellCheck="false"
            />

            {codecMode === 'json' && (() => {
              try {
                const f = formatJsonSafe(codecInput);
                return (
                  <div className="mt-12">
                    <div className="flex justify-between items-center" style={{ marginBottom: 6 }}>
                      <span className="tag-pill" style={{ background: 'var(--ok-bg)', color: 'var(--ok)' }}>
                        Valid JSON
                      </span>
                      <div className="flex gap-6">
                        <button type="button" className="btn btn-secondary btn-sm" onClick={() => copyVal(f.pretty)}>
                          <Copy size={13} /> Pretty
                        </button>
                        <button type="button" className="btn btn-secondary btn-sm" onClick={() => copyVal(f.minified)}>
                          <Copy size={13} /> Minify
                        </button>
                      </div>
                    </div>
                    <pre className="md-pre"><code>{f.pretty}</code></pre>
                  </div>
                );
              } catch (e) {
                return <div className="inline-mistake mt-12">Invalid JSON: {e.message}</div>;
              }
            })()}

            {codecMode === 'jwt' && (() => {
              try {
                const j = decodeJwtOffline(codecInput);
                return (
                  <div className="mt-12">
                    {j.expiresAt && (
                      <div
                        className="tag-pill"
                        style={{
                          marginBottom: 8,
                          background: j.expired ? 'var(--mistake-bg)' : 'var(--ok-bg)',
                          color: j.expired ? 'var(--mistake-ink)' : 'var(--ok)',
                        }}
                      >
                        {j.expired ? `Expired: ${j.expiresAt}` : `Valid until: ${j.expiresAt}`}
                      </div>
                    )}
                    <div className="settings-label">Header</div>
                    <pre className="md-pre"><code>{JSON.stringify(j.header, null, 2)}</code></pre>
                    <div className="settings-label mt-8">Payload</div>
                    <pre className="md-pre"><code>{JSON.stringify(j.payload, null, 2)}</code></pre>
                  </div>
                );
              } catch (e) {
                return <div className="inline-mistake mt-12">{e.message}</div>;
              }
            })()}

            {(codecMode === 'base64' || codecMode === 'url') && (
              <div className="flex gap-8 mt-12">
                <button
                  type="button"
                  className="btn btn-primary btn-sm flex-1"
                  onClick={() => {
                    try {
                      setCodecInput(
                        codecMode === 'base64'
                          ? encodeBase64Utf8(codecInput)
                          : encodeURIComponent(codecInput)
                      );
                    } catch (e) {
                      toast(e.message, { type: 'error' });
                    }
                  }}
                >
                  Encode
                </button>
                <button
                  type="button"
                  className="btn btn-secondary btn-sm flex-1"
                  onClick={() => {
                    try {
                      setCodecInput(
                        codecMode === 'base64'
                          ? decodeBase64Utf8(codecInput)
                          : decodeURIComponent(codecInput)
                      );
                    } catch {
                      toast('Input is not validly encoded', { type: 'error' });
                    }
                  }}
                >
                  Decode
                </button>
                <button
                  type="button"
                  className="btn btn-secondary btn-sm"
                  onClick={() => copyVal(codecInput)}
                >
                  <Copy size={14} />
                </button>
              </div>
            )}
          </div>
        )}

        {/* 4. Live Regex Tester */}
        {tab === 'regex' && (
          <div className="explanation-card">
            <div className="settings-label">Pattern &amp; Flags</div>
            <div className="flex gap-8">
              <input
                type="text"
                className="ai-input flex-1"
                value={regexPat}
                onChange={e => setRegexPat(e.target.value)}
                placeholder="Regex pattern"
                spellCheck="false"
              />
              <input
                type="text"
                className="ai-input"
                style={{ width: 64 }}
                value={regexFlags}
                onChange={e => setRegexFlags(e.target.value)}
                placeholder="gim"
                aria-label="Regex flags"
                spellCheck="false"
              />
            </div>

            <div className="settings-label mt-12">Test String</div>
            <textarea
              className="ai-input"
              rows={4}
              value={regexSample}
              onChange={e => setRegexSample(e.target.value)}
              spellCheck="false"
            />

            {!regexRes.valid ? (
              <div className="inline-mistake mt-12">Regex error: {regexRes.error}</div>
            ) : (
              <div className="mt-12">
                <div className="settings-label">
                  Matches ({regexRes.matches.length})
                </div>
                {regexRes.matches.length === 0 ? (
                  <div style={{ fontSize: 13, color: 'var(--text-secondary)' }}>No matches.</div>
                ) : (
                  <div className="flex gap-6" style={{ flexWrap: 'wrap' }}>
                    {regexRes.matches.slice(0, 30).map((m, i) => (
                      <span key={i} className="tag-pill" style={{ fontFamily: 'var(--font-mono)' }}>
                        “{m.match}” @{m.index}
                      </span>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {/* 5. Offline Quick Cheat Sheets */}
        {tab === 'sheets' && (
          <div className="explanation-card">
            <div className="mode-picker-row" style={{ marginBottom: 12 }}>
              {IT_CHEAT_SHEETS.map(s => (
                <button
                  key={s.id}
                  type="button"
                  className={`mode-pick-chip${sheetId === s.id ? ' active' : ''}`}
                  onClick={() => setSheetId(s.id)}
                >
                  {s.label}
                </button>
              ))}
            </div>

            <div className="flex justify-between items-center" style={{ marginBottom: 10 }}>
              <strong style={{ fontSize: 15 }}>{activeSheet.title}</strong>
              <div className="flex gap-6">
                <button
                  type="button"
                  className="btn btn-secondary btn-sm"
                  onClick={() => copyVal(activeSheet.markdown)}
                >
                  <Copy size={13} /> Copy
                </button>
                <button
                  type="button"
                  className="btn btn-primary btn-sm"
                  onClick={() => saveAsNote(activeSheet.title, activeSheet.markdown)}
                >
                  <FilePlus2 size={13} /> Save Note
                </button>
              </div>
            </div>

            <MarkdownContent text={activeSheet.markdown} />
          </div>
        )}
      </div>
    </div>
  );
}
