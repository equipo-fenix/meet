import { describe, expect, it } from 'vitest';
import { sessionIdFromVerifiedPass, type RoomPassResult } from './roomPass';

describe('sessionIdFromVerifiedPass', () => {
  it('usa el ID de APEX firmado aunque el nombre de sala sea un slug distinto', () => {
    const result: RoomPassResult = {
      valid: true,
      payload: {
        r: 'fenix-construye-una-empres-260727',
        sid: '0c96a04a-b499-4900-9132-54c6cb9fa8ef',
        h: 1,
        exp: Math.floor(Date.now() / 1000) + 60,
      },
    };

    expect(sessionIdFromVerifiedPass(result)).toBe('0c96a04a-b499-4900-9132-54c6cb9fa8ef');
    expect(sessionIdFromVerifiedPass(result)).not.toBe(result.payload.r);
  });

  it('no confía en un ID cuando el pase no fue verificado', () => {
    const result: RoomPassResult = { valid: false, reason: 'bad_signature' };
    expect(sessionIdFromVerifiedPass(result)).toBeUndefined();
  });
});
