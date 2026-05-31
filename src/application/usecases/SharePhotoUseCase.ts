import { Photo } from '../../domain/entities/Photo';
import {
  IPhotoRepository,
  ISubscriberRepository,
  INotifier,
  IStorageService,
} from '../../domain/interfaces';
import { PhotoMapper } from '../mappers/PhotoMapper';
import { PhotoDto } from '../dtos';

interface SharePhotoInput {
  photoId: string;
  ownerId: string;
  localUri: string;
  filename: string;
}

export class SharePhotoUseCase {
  constructor(
    private readonly photoRepo: IPhotoRepository,
    private readonly subscriberRepo: ISubscriberRepository,
    private readonly notifier: INotifier,
    private readonly storage: IStorageService,
  ) {}

  async execute(input: SharePhotoInput): Promise<PhotoDto> {
    const url = await this.storage.upload(input.localUri, input.filename);

    const photo = Photo.create({
      id: input.photoId,
      ownerId: input.ownerId,
      url,
      createdAt: new Date(),
    });

    await this.photoRepo.save(photo);

    const subscribers = await this.subscriberRepo.findActiveByPublisher(input.ownerId);

    await Promise.all(subscribers.map(s => this.notifier.notify(s, photo)));

    return PhotoMapper.toDto(photo);
  }
}
