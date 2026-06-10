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

  it('defaults mediaType to image', () => {
    const media = Media.create(validProps);
    expect(media.mediaType).toBe('image');
  });

  it('stores video mediaType', () => {
    const media = Media.create({ ...validProps, mediaType: 'video' });
    expect(media.mediaType).toBe('video');
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
