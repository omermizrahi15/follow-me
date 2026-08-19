import type { DeviceContact } from '../interfaces';
import {
  indexContactsByNumber,
  matchHandlesToContacts,
  resolveContactNames,
  sortByResolvedName,
} from './contactNames';

function contact(props: Partial<DeviceContact> & { id: string }): DeviceContact {
  return { name: null, imageUri: null, phoneNumbers: [], ...props };
}

const IL = '972';

describe('indexContactsByNumber', () => {
  it('keys a contact under every number it holds, normalised', () => {
    const index = indexContactsByNumber(
      [contact({ id: '1', name: 'Dana', phoneNumbers: ['050-123 4567', '+972 3 555 0000'] })],
      IL,
    );

    expect(index.get('+972501234567')?.name).toBe('Dana');
    expect(index.get('+97235550000')?.name).toBe('Dana');
  });

  it('keeps the contact photo', () => {
    const index = indexContactsByNumber(
      [contact({ id: '1', name: 'Dana', imageUri: 'file:///dana.jpg', phoneNumbers: ['0501234567'] })],
      IL,
    );

    expect(index.get('+972501234567')?.imageUri).toBe('file:///dana.jpg');
  });

  it('drops contacts with no name — the number says as much', () => {
    const index = indexContactsByNumber(
      [contact({ id: '1', name: '  ', phoneNumbers: ['0501234567'] })],
      IL,
    );

    expect(index.size).toBe(0);
  });

  it('skips numbers that cannot be normalised', () => {
    const index = indexContactsByNumber(
      [contact({ id: '1', name: 'Voicemail', phoneNumbers: ['*123#'] })],
      IL,
    );

    expect(index.size).toBe(0);
  });

  it('picks the same winner when two contacts share a number, whatever the order', () => {
    const dana = contact({ id: 'b', name: 'Dana', phoneNumbers: ['0501234567'] });
    const zoe = contact({ id: 'a', name: 'Zoe', phoneNumbers: ['0501234567'] });

    expect(indexContactsByNumber([dana, zoe], IL).get('+972501234567')?.name).toBe('Dana');
    expect(indexContactsByNumber([zoe, dana], IL).get('+972501234567')?.name).toBe('Dana');
  });

  it('prefers the entry with a photo when a number is duplicated', () => {
    const plain = contact({ id: 'a', name: 'Dana', phoneNumbers: ['0501234567'] });
    const withPhoto = contact({
      id: 'b',
      name: 'Dana Levi',
      imageUri: 'file:///dana.jpg',
      phoneNumbers: ['0501234567'],
    });

    expect(indexContactsByNumber([plain, withPhoto], IL).get('+972501234567')?.name).toBe('Dana Levi');
  });
});

describe('matchHandlesToContacts', () => {
  const index = indexContactsByNumber(
    [contact({ id: '1', name: 'Dana', phoneNumbers: ['050-123 4567'] })],
    IL,
  );

  it('matches an E.164 subscriber handle against a national address-book number', () => {
    expect(matchHandlesToContacts(['+972501234567'], index, IL).get('+972501234567')?.name).toBe('Dana');
  });

  it('leaves unmatched handles out of the map entirely', () => {
    expect(matchHandlesToContacts(['+972500000000'], index, IL).size).toBe(0);
  });
});

describe('resolveContactNames', () => {
  it('resolves the handles it can and ignores the rest', () => {
    const names = resolveContactNames(
      [
        contact({ id: '1', name: 'Dana', phoneNumbers: ['0501234567'] }),
        contact({ id: '2', name: 'Noa', phoneNumbers: ['00972 52 765 4321'] }),
      ],
      ['+972501234567', '+972527654321', '+972539999999'],
      IL,
    );

    expect(names.get('+972501234567')?.name).toBe('Dana');
    expect(names.get('+972527654321')?.name).toBe('Noa');
    expect(names.has('+972539999999')).toBe(false);
  });

  it('matches nothing rather than guessing when the publisher region is unknown', () => {
    const names = resolveContactNames(
      [contact({ id: '1', name: 'Dana', phoneNumbers: ['0501234567'] })],
      ['+972501234567'],
      null,
    );

    expect(names.size).toBe(0);
  });

  it('still matches an internationally-stored contact without a publisher region', () => {
    const names = resolveContactNames(
      [contact({ id: '1', name: 'Dana', phoneNumbers: ['+972 50 123 4567'] })],
      ['+972501234567'],
      null,
    );

    expect(names.get('+972501234567')?.name).toBe('Dana');
  });
});

describe('sortByResolvedName', () => {
  it('sorts matched names alphabetically and leaves numbers last', () => {
    const rows = [
      { handle: '+972539999999', name: null },
      { handle: '+972501234567', name: 'dana' },
      { handle: '+972521111111', name: 'Avi' },
      { handle: '+972501111111', name: null },
    ];

    const sorted = sortByResolvedName(rows, r => r.name, r => r.handle);

    expect(sorted.map(r => r.name ?? r.handle)).toEqual([
      'Avi',
      'dana',
      '+972501111111',
      '+972539999999',
    ]);
  });

  it('does not mutate the input', () => {
    const rows = [{ handle: '+2', name: 'B' }, { handle: '+1', name: 'A' }];
    sortByResolvedName(rows, r => r.name, r => r.handle);
    expect(rows.map(r => r.name)).toEqual(['B', 'A']);
  });
});
