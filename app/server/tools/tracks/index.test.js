'use strict';

jest.mock('./mixer_lifecycle', () => ({ register: jest.fn() }));
jest.mock('./routing', () => ({ register: jest.fn() }));
jest.mock('./devices', () => ({ register: jest.fn() }));
jest.mock('./take_lanes', () => ({ register: jest.fn() }));
jest.mock('./view', () => ({ register: jest.fn() }));
jest.mock('./groups', () => ({ register: jest.fn() }));
jest.mock('./crossfader', () => ({ register: jest.fn() }));
jest.mock('./master', () => ({ register: jest.fn() }));
jest.mock('./returns', () => ({ register: jest.fn() }));
jest.mock('./device_io', () => ({ register: jest.fn() }));
jest.mock('./devices_params', () => ({ register: jest.fn() }));

const family = require('./index');
const subModules = [
  './mixer_lifecycle',
  './routing',
  './devices',
  './take_lanes',
  './view',
  './groups',
  './crossfader',
  './master',
  './returns',
  './device_io',
  './devices_params',
].map((m) => require(m));

it('register() chains every sub-module register with the same server arg', () => {
  const server = { tool: jest.fn() };
  family.register(server);
  for (const sub of subModules) {
    expect(sub.register).toHaveBeenCalledTimes(1);
    expect(sub.register).toHaveBeenCalledWith(server);
  }
});
