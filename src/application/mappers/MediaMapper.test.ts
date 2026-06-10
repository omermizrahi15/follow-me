import { Media } from '../../domain/entities/Media';
import { MediaMapper } from './MediaMapper';

const media = Media.create({
  id: 'media-1',
  ownerId: 'user-1',
  url: 'https://cdn.example.com/photo.jpg',
  createdAt: new Date('2024-01-01T00:00:00.000Z'),
});

describe('MediaMapper', () => {
  it('maps domain to dto', () => {
    const dto = MediaMapper.toDto(media);
    expect(dto.id).toBe('media-1');
    expect(dto.createdAt).toBe('2024-01-01T00:00:00.000Z');
  });

  it('maps dto back to domain', () => {
    const dto = MediaMapper.toDto(media);
    const restored = MediaMapper.toDomain(dto);
    expect(restored.id).toBe(media.id);
    expect(restored.url).toBe(media.url);
  });

  it('round-trips without data loss', () => {
    const dto = MediaMapper.toDto(media);
    const restored = MediaMapper.toDomain(dto);
    expect(MediaMapper.toDto(restored)).toEqual(dto);
  });
});
