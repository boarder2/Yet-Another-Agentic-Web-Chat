import { describe, expect, it } from 'vitest';
import {
  headerRowsToCreatePayload,
  headerRowsToPatch,
} from './OpenAICompatibleProviderModal';

type HeaderRow = { id: string; name: string; value: string };

const row = (id: string, name: string, value: string): HeaderRow => ({
  id,
  name,
  value,
});

describe('OpenAI-compatible provider header form helpers', () => {
  it('builds create headers from named rows and omits empty rows', () => {
    expect(
      headerRowsToCreatePayload([
        row('authorization', ' Authorization ', 'Bearer secret'),
        row('api-key', 'X-API-Key', 'key'),
        row('empty', '   ', ''),
      ]),
    ).toEqual({
      Authorization: 'Bearer secret',
      'X-API-Key': 'key',
    });

    expect(headerRowsToCreatePayload([row('empty', ' ', '')])).toBeUndefined();
  });

  it('preserves blank existing values and removes omitted rows', () => {
    expect(
      headerRowsToPatch(
        [
          row('authorization', 'Authorization', ''),
          row('keep', 'X-Keep', 'replacement'),
        ],
        ['Authorization', 'X-Keep', 'X-Remove'],
      ),
    ).toEqual({
      'X-Keep': 'replacement',
      'X-Remove': null,
    });
  });

  it('emits values for newly added headers while matching stored names case-insensitively', () => {
    expect(
      headerRowsToPatch(
        [
          row('authorization', 'authorization', ''),
          row('new', ' X-New ', 'new-secret'),
        ],
        ['Authorization'],
      ),
    ).toEqual({ 'X-New': 'new-secret' });
  });
});
