'use strict';

jest.mock('fs');
jest.mock('./python', () => ({ isAlive: jest.fn() }));

const fs = require('fs');
const path = require('path');
const os = require('os');
const { isAlive } = require('./python');
const companion = require('./companion');

const SCRIPT_PY = path.join(
  os.homedir(),
  'Music',
  'Ableton',
  'User Library',
  'Remote Scripts',
  'agent4live',
  '__init__.py',
);
const SCRIPT_PYC = path.join(
  os.homedir(),
  'Music',
  'Ableton',
  'User Library',
  'Remote Scripts',
  'agent4live',
  '__init__.pyc',
);

beforeEach(() => {
  jest.clearAllMocks();
});

describe('getCompanionStatus', () => {
  it('script absent → scriptInstalled=false, pingOk=false (no ping attempted)', async () => {
    fs.existsSync.mockReturnValue(false);
    expect(await companion.getCompanionStatus()).toEqual({
      scriptInstalled: false,
      pingOk: false,
    });
    expect(isAlive).not.toHaveBeenCalled();
  });

  it('script present + ping ok → both true', async () => {
    fs.existsSync.mockReturnValue(true);
    isAlive.mockResolvedValue(true);
    expect(await companion.getCompanionStatus()).toEqual({
      scriptInstalled: true,
      pingOk: true,
    });
  });

  it('script present + ping ko → scriptInstalled=true, pingOk=false', async () => {
    fs.existsSync.mockReturnValue(true);
    isAlive.mockResolvedValue(false);
    expect(await companion.getCompanionStatus()).toEqual({
      scriptInstalled: true,
      pingOk: false,
    });
  });
});

describe('installCompanion', () => {
  const PY = '# python source';
  const PYC = new Uint8Array([0xa7, 0x0d, 0x0d, 0x0a, 0x01, 0x02]);

  beforeEach(() => {
    fs.existsSync.mockImplementation((p) => p.includes('User Library'));
    fs.mkdirSync.mockImplementation(() => {});
    fs.writeFileSync.mockImplementation(() => {});
  });

  it('writes the .py + .pyc and returns ok', async () => {
    const r = await companion.installCompanion(PY, PYC);
    expect(r).toEqual({ ok: true });
    expect(fs.writeFileSync).toHaveBeenCalledWith(SCRIPT_PY, PY, 'utf8');
    expect(fs.writeFileSync).toHaveBeenCalledWith(SCRIPT_PYC, expect.any(Buffer));
    // The Buffer must contain the same bytes we passed in.
    const pycCall = fs.writeFileSync.mock.calls.find((c) => c[0] === SCRIPT_PYC);
    expect(pycCall[1].equals(Buffer.from(PYC))).toBe(true);
  });

  it('returns ok=false when writeFileSync throws', async () => {
    fs.writeFileSync.mockImplementation(() => {
      throw new Error('disk full');
    });
    const r = await companion.installCompanion(PY, PYC);
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/disk full/);
  });

  it('creates Remote Scripts dir if missing', async () => {
    fs.existsSync.mockReturnValue(false);
    fs.mkdirSync.mockImplementation(() => {});
    const r = await companion.installCompanion(PY, PYC);
    expect(r.ok).toBe(true);
    expect(fs.mkdirSync).toHaveBeenCalledWith(expect.stringContaining('Remote Scripts'), {
      recursive: true,
    });
  });

  it('returns ok=false when Remote Scripts dir cannot be created', async () => {
    fs.existsSync.mockReturnValue(false);
    fs.mkdirSync.mockImplementation(() => {
      throw new Error('EACCES');
    });
    const r = await companion.installCompanion(PY, PYC);
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/cannot create/);
  });
});
