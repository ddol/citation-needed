import { bold, green, paint, print, printError, red, supportsColor } from '../../../src/cli/output';

describe('CLI output helpers', () => {
  const originalEnv = { ...process.env };
  const originalIsTTY = process.stdout.isTTY;
  let stdout: jest.SpyInstance;
  let stderr: jest.SpyInstance;

  beforeEach(() => {
    process.env = { ...originalEnv };
    Object.defineProperty(process.stdout, 'isTTY', { configurable: true, value: false });
    stdout = jest.spyOn(console, 'log').mockImplementation(() => undefined);
    stderr = jest.spyOn(console, 'error').mockImplementation(() => undefined);
  });

  afterEach(() => {
    stdout.mockRestore();
    stderr.mockRestore();
    process.env = { ...originalEnv };
    Object.defineProperty(process.stdout, 'isTTY', { configurable: true, value: originalIsTTY });
  });

  test('honors NO_COLOR, FORCE_COLOR, and TTY color detection', () => {
    delete process.env.NO_COLOR;
    delete process.env.FORCE_COLOR;

    expect(supportsColor()).toBe(false);
    expect(red('error')).toBe('error');

    Object.defineProperty(process.stdout, 'isTTY', { configurable: true, value: true });
    expect(supportsColor()).toBe(true);
    expect(green('ok')).toBe('\x1b[32mok\x1b[39m');

    process.env.NO_COLOR = '1';
    expect(supportsColor()).toBe(false);

    delete process.env.NO_COLOR;
    process.env.FORCE_COLOR = '1';
    Object.defineProperty(process.stdout, 'isTTY', { configurable: true, value: false });
    expect(supportsColor()).toBe(true);
    expect(bold('name')).toBe('\x1b[1mname\x1b[22m');
    expect(paint('subtle', 'dim')).toBe('\x1b[2msubtle\x1b[22m');
  });

  // FORCE_COLOR=0 is how most tools ask for colour off. Treating any set value
  // as "on" turned colour on for the user trying to turn it off.
  test('treats FORCE_COLOR=0 as colour off, even on a TTY', () => {
    delete process.env.NO_COLOR;
    Object.defineProperty(process.stdout, 'isTTY', { configurable: true, value: true });

    process.env.FORCE_COLOR = '0';
    expect(supportsColor()).toBe(false);
    expect(red('error')).toBe('error');

    process.env.FORCE_COLOR = '1';
    expect(supportsColor()).toBe(true);

    // An empty value carries no instruction, so TTY detection decides.
    process.env.FORCE_COLOR = '';
    expect(supportsColor()).toBe(true);

    // NO_COLOR still wins over an explicit FORCE_COLOR.
    process.env.NO_COLOR = '1';
    process.env.FORCE_COLOR = '1';
    expect(supportsColor()).toBe(false);
  });

  test('prints joined stdout lines, blank lines, and stderr separately', () => {
    print('one', 'two');
    print();
    printError('bad', 'worse');

    expect(stdout).toHaveBeenNthCalledWith(1, 'one\ntwo');
    expect(stdout).toHaveBeenNthCalledWith(2, '');
    expect(stderr).toHaveBeenCalledWith('bad\nworse');
  });
});
