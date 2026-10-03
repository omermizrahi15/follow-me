import { removeSlot } from './removeSlot';

describe('removeSlot', () => {
  it('drops the photo and keeps the order of the rest', () => {
    expect(removeSlot(['a', 'b', 'c'], 'b')).toEqual(['a', 'c']);
  });

  it('ignores an id that is not in the post', () => {
    const slots = ['a', 'b'];
    expect(removeSlot(slots, 'z')).toBe(slots);
  });

  it('never removes the last photo — a post needs at least one', () => {
    const slots = ['a'];
    expect(removeSlot(slots, 'a')).toBe(slots);
  });
});
