import { describe, expect, it } from 'vitest';
import { sessionIdHintFromPass } from './clientRoomPass';

function unsignedPass(payload: object): string {
  const encoded = Buffer.from(JSON.stringify(payload)).toString('base64url');
  return `v1.${encoded}.firma-que-el-cliente-no-valida`;
}

describe('sessionIdHintFromPass', () => {
  it('recupera el ID usado para enrutar la puerta', () => {
    expect(
      sessionIdHintFromPass(
        unsignedPass({
          r: 'fenix-sala-legible',
          sid: 'a1eea24f-e54b-46f6-92b8-8661ec346304',
        }),
      ),
    ).toBe('a1eea24f-e54b-46f6-92b8-8661ec346304');
  });

  it('falla cerrado ante sobres mal formados', () => {
    expect(sessionIdHintFromPass('no-es-un-pase')).toBeUndefined();
    expect(sessionIdHintFromPass(unsignedPass({ r: 'sin-sid' }))).toBeUndefined();
  });
});
