import { describe, expect, it } from 'vitest';
import { isCanonicalLocalClientToken } from '../local-client-token';
import { decodeCanonicalLocalClientToken } from '../../server/src/lib/local-client-token';

const canonicalToken = 'paWlpaWlpaWlpaWlpaWlpaWlpaWlpaWlpaWlpaWlpaU';
const textualAlias = 'paWlpaWlpaWlpaWlpaWlpaWlpaWlpaWlpaWlpaWlpaV';

describe('local client token contract', () => {
  it.each([
    [canonicalToken, true],
    [textualAlias, false],
    ['too-short', false],
    [`${canonicalToken}=`, false]
  ])('keeps backend and extension build validation aligned for %s', (token, expected) => {
    expect(decodeCanonicalLocalClientToken(token) !== undefined).toBe(expected);
    expect(isCanonicalLocalClientToken(token)).toBe(expected);
  });

  it('proves the rejected textual alias decodes to the same bytes', () => {
    expect(Buffer.from(textualAlias, 'base64url')).toEqual(Buffer.from(canonicalToken, 'base64url'));
  });
});
