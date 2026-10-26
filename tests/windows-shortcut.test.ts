import { expect, it } from 'vitest';
import { encodeWindowsIcon } from '../scripts/windows-shortcut.js';
import { iconPngFrames } from './icon-fixtures.js';

it('packages exact PNG bytes into a multi-size Windows ICO with correct dimensions and offsets', () => {
  const sizes = [16,32,48,256];
  const frames = sizes.map(size => Buffer.from(iconPngFrames[String(size)], 'base64'));
  const icon = encodeWindowsIcon(frames);
  expect(icon.readUInt16LE(0)).toBe(0);
  expect(icon.readUInt16LE(2)).toBe(1);
  expect(icon.readUInt16LE(4)).toBe(4);
  let offset = 6 + 16 * frames.length;
  sizes.forEach((size, index) => {
    const entry = 6 + 16 * index;
    expect(icon[entry]).toBe(size === 256 ? 0 : size);
    expect(icon[entry + 1]).toBe(icon[entry]);
    expect(icon.readUInt16LE(entry + 4)).toBe(1);
    expect(icon.readUInt16LE(entry + 6)).toBe(32);
    expect(icon.readUInt32LE(entry + 8)).toBe(frames[index].length);
    expect(icon.readUInt32LE(entry + 12)).toBe(offset);
    expect(icon.subarray(offset, offset + frames[index].length)).toEqual(frames[index]);
    offset += frames[index].length;
  });
  expect(icon.length).toBe(offset);
});

it('rejects malformed, duplicate, nonsquare and oversized icon frames', () => {
  const png = Buffer.from(iconPngFrames['16'], 'base64');
  expect(() => encodeWindowsIcon([])).toThrow();
  expect(() => encodeWindowsIcon([Buffer.from('not a PNG')])).toThrow('Invalid PNG');
  expect(() => encodeWindowsIcon([png,png])).toThrow('unique square');
  const nonsquare = Buffer.from(png); nonsquare.writeUInt32BE(20,20);
  expect(() => encodeWindowsIcon([nonsquare])).toThrow('unique square');
  const large = Buffer.from(png); large.writeUInt32BE(257,16); large.writeUInt32BE(257,20);
  expect(() => encodeWindowsIcon([large])).toThrow('up to 256px');
});
