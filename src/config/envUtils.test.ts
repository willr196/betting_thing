import { describe, expect, it } from 'vitest';
import { normalizeEnvValue, normalizeProcessEnv } from './envUtils.js';

describe('env normalization helpers', () => {
  it('trims values and removes wrapping quotes', () => {
    expect(normalizeEnvValue('  "production"  ')).toBe('production');
    expect(normalizeEnvValue("  'https://example.com'  ")).toBe('https://example.com');
  });

  it('treats blank values as unset by default', () => {
    expect(normalizeEnvValue('')).toBeUndefined();
    expect(normalizeEnvValue('   ')).toBeUndefined();
    expect(normalizeEnvValue('  ""  ')).toBeUndefined();
  });

  it('can preserve blank values for keys that must fail explicitly', () => {
    expect(
      normalizeEnvValue('   ', {
        emptyStringAsUndefined: false,
      })
    ).toBe('');
  });

  it('normalizes process env objects while preserving configured blank keys', () => {
    expect(
      normalizeProcessEnv(
        {
          NODE_ENV: '',
          SMTP_USER: '   ',
          FRONTEND_URL: ' "https://frontend.example.com" ',
        },
        {
          preserveEmptyKeys: ['NODE_ENV'],
        }
      )
    ).toEqual({
      NODE_ENV: '',
      SMTP_USER: undefined,
      FRONTEND_URL: 'https://frontend.example.com',
    });
  });
});
