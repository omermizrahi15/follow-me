import { Media } from '../../domain/entities/Media';
import type {
  IMediaRepository,
  ISubscriberRepository,
  INotifier,
  IStorageService,
} from '../../domain/interfaces';
import { MediaMapper } from '../mappers/MediaMapper';
import type { MediaDto } from '../dtos';

interface ShareMediaInput {
  mediaId: string;
  ownerId: string;
  localUri: string;
  filename: string;
}

export class ShareMediaUseCase {
  constructor(
    private readonly mediaRepo: IMediaRepository,
    private readonly subscriberRepo: ISubscriberRepository,
    private readonly notifier: INotifier,
    private readonly storage: IStorageService,
  ) {}

  async share(input: ShareMediaInput): Promise<MediaDto> {
    const url = await this.storage.upload(input.localUri, input.filename);

    const media = Media.create({
      id: input.mediaId,
      ownerId: input.ownerId,
      url,
      createdAt: new Date(),
    });

    await this.mediaRepo.save(media);

    const subscribers = await this.subscriberRepo.findActiveByPublisher(input.ownerId);
    await Promise.all(subscribers.map(s => this.notifier.notify(s, media)));

    return MediaMapper.toDto(media);
  }
}
