import { Photo } from '../../domain/entities/Photo';
import { PhotoMapper } from './PhotoMapper';

const photo = Photo.create({
  id: 'photo-1',
  ownerId: 'user-1',
  url: 'https://cdn.example.com/photo.jpg',
  createdAt: new Date('2024-01-01T00:00:00.000Z'),
});

describe('PhotoMapper', () => {
  it('maps domain to dto', () => {
    const dto = PhotoMapper.toDto(photo);
    expect(dto.id).toBe('photo-1');
    expect(dto.createdAt).toBe('2024-01-01T00:00:00.000Z');
  });

  it('maps dto back to domain', () => {
    const dto = PhotoMapper.toDto(photo);
    const restored = PhotoMapper.toDomain(dto);
    expect(restored.id).toBe(photo.id);
    expect(restored.url).toBe(photo.url);
  });

  it('round-trips without data loss', () => {
    const dto = PhotoMapper.toDto(photo);
    const restored = PhotoMapper.toDomain(dto);
    expect(PhotoMapper.toDto(restored)).toEqual(dto);
  });
});
