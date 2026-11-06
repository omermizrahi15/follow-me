import { removeSlot } from './photoSlots';

describe('removeSlot', () => {
  it('drops the photo and keeps the order of the rest', () => {
    expect(removeSlot(['a', 'b', 'c'], 'b')).toEqual(['a', 'c']);
  });

  it('keeps the last photo: a post with none has nothing to publish', () => {
    expect(removeSlot(['a'], 'a')).toEqual(['a']);
  });

  it('ignores a photo that is not in the post', () => {
    expect(removeSlot(['a', 'b'], 'z')).toEqual(['a', 'b']);
  });
});
