import { Media } from '../../domain/entities/Media';
import type { MediaDto } from '../dtos';

export class MediaMapper {
  static toDto(media: Media): MediaDto {
    return {
      id: media.id,
      ownerId: media.ownerId,
      url: media.url,
      createdAt: media.createdAt.toISOString(),
    };
  }

  static toDomain(dto: MediaDto): Media {
    return Media.create({
      id: dto.id,
      ownerId: dto.ownerId,
      url: dto.url,
      createdAt: new Date(dto.createdAt),
    });
  }
}
