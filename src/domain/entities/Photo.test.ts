import { Photo } from './Photo';

const validProps = {
  id: 'photo-1',
  ownerId: 'user-1',
  url: 'https://cdn.example.com/photo.jpg',
  createdAt: new Date('2024-01-01'),
};

describe('Photo', () => {
  it('creates a valid photo', () => {
    const photo = Photo.create(validProps);
    expect(photo.id).toBe('photo-1');
    expect(photo.ownerId).toBe('user-1');
    expect(photo.url).toBe('https://cdn.example.com/photo.jpg');
  });

  it('throws if ownerId is missing', () => {
    expect(() => Photo.create({ ...validProps, ownerId: '' }))
      .toThrow('Photo must have an owner');
  });

  it('throws if url is missing', () => {
    expect(() => Photo.create({ ...validProps, url: '' }))
      .toThrow('Photo must have a url');
  });
});
