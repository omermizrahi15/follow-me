import { Media } from './Media';

const validProps = {
  id: 'media-1',
  ownerId: 'user-1',
  url: 'https://cdn.example.com/photo.jpg',
  createdAt: new Date('2024-01-01'),
};

describe('Media', () => {
  it('creates a valid media item', () => {
    const media = Media.create(validProps);
    expect(media.id).toBe('media-1');
    expect(media.ownerId).toBe('user-1');
    expect(media.url).toBe('https://cdn.example.com/photo.jpg');
  });

  it('stores the postingId that groups a shared batch', () => {
    const media = Media.create({ ...validProps, postingId: 'posting-1' });
    expect(media.postingId).toBe('posting-1');
  });

  it('has no postingId by default', () => {
    const media = Media.create(validProps);
    expect(media.postingId).toBeUndefined();
  });

  it('stores the posting song when provided', () => {
    const song = { title: 'Vienna', artist: 'Billy Joel' };
    const media = Media.create({ ...validProps, song });
    expect(media.song).toEqual(song);
  });

  it('has no song by default', () => {
    const media = Media.create(validProps);
    expect(media.song).toBeUndefined();
  });

  it('throws if ownerId is missing', () => {
    expect(() => Media.create({ ...validProps, ownerId: '' }))
      .toThrow('Media must have an owner');
  });

  it('throws if url is missing', () => {
    expect(() => Media.create({ ...validProps, url: '' }))
      .toThrow('Media must have a url');
  });
});
