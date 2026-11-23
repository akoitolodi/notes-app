import { describe, it, expect } from 'vitest';
import {
  calculateSubnet,
  convertNumberBase,
  computeBitwise,
  formatJsonSafe,
  encodeBase64Utf8,
  decodeBase64Utf8,
  decodeJwtOffline,
  testRegexLive,
} from '../src/lib/itTools.js';

describe('Offline Dev & IT Pocket Toolkit', () => {
  it('computes accurate IPv4 CIDR subnetting across /26, /30, /31, and /32', () => {
    const s26 = calculateSubnet('192.168.10.42/26');
    expect(s26.networkAddress).toBe('192.168.10.0');
    expect(s26.broadcastAddress).toBe('192.168.10.63');
    expect(s26.firstUsable).toBe('192.168.10.1');
    expect(s26.lastUsable).toBe('192.168.10.62');
    expect(s26.usableHosts).toBe(62);
    expect(s26.subnetMask).toBe('255.255.255.192');
    expect(s26.wildcardMask).toBe('0.0.0.63');
    expect(s26.scope).toContain('Private');

    const s32 = calculateSubnet('8.8.8.8/32');
    expect(s32.usableHosts).toBe(1);
    expect(s32.scope).toBe('Public');

    const s31 = calculateSubnet('10.0.0.0/31');
    expect(s31.usableHosts).toBe(2);

    expect(() => calculateSubnet('999.1.1.1/24')).toThrow();
  });

  it('converts number bases and runs bitwise operations accurately', () => {
    const conv = convertNumberBase('FF', 16);
    expect(conv).toEqual({ bin: '11111111', oct: '377', dec: '255', hex: 'FF' });

    expect(computeBitwise('12', '10', 'AND').dec).toBe('8');
    expect(computeBitwise('12', '10', 'XOR').dec).toBe('6');
    expect(computeBitwise('1', '4', 'SHL').dec).toBe('16');
  });

  it('formats JSON, encodes/decodes UTF-8 Base64, and decodes JWTs offline', () => {
    const json = formatJsonSafe('{"a":1,"b":[2,3]}');
    expect(json.minified).toBe('{"a":1,"b":[2,3]}');

    const b64 = encodeBase64Utf8('Notes by Bai ✨');
    expect(decodeBase64Utf8(b64)).toBe('Notes by Bai ✨');

    const hdr = encodeBase64Utf8(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
    const pay = encodeBase64Utf8(JSON.stringify({ sub: 'student1', role: 'BSIT' }));
    const decoded = decodeJwtOffline(`${hdr}.${pay}.sig`);
    expect(decoded.header.alg).toBe('HS256');
    expect(decoded.payload.role).toBe('BSIT');
  });

  it('tests regex safely without hanging on zero-width matches', () => {
    const res = testRegexLive('\\b[A-Z][a-z]+\\b', 'g', 'Notes by Bai');
    expect(res.valid).toBe(true);
    expect(res.matches.map(m => m.match)).toEqual(['Notes', 'Bai']);

    const zeroWidth = testRegexLive('a*', 'g', 'bbb');
    expect(zeroWidth.valid).toBe(true);
    expect(zeroWidth.matches.length).toBeGreaterThan(0);

    const invalid = testRegexLive('[unclosed', 'g', 'abc');
    expect(invalid.valid).toBe(false);
  });
});
