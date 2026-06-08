import { Photo } from '../../domain/entities/Photo';
import type { PhotoDto } from '../dtos';

export class PhotoMapper {
  static toDto(photo: Photo): PhotoDto {
    return {
      id: photo.id,
      ownerId: photo.ownerId,
      url: photo.url,
      createdAt: photo.createdAt.toISOString(),
    };
  }

  static toDomain(dto: PhotoDto): Photo {
    return Photo.create({
      id: dto.id,
      ownerId: dto.ownerId,
      url: dto.url,
      createdAt: new Date(dto.createdAt),
    });
  }
}
