import { SyncCandidatePhotosUseCase } from './SyncCandidatePhotosUseCase';
import type { PhotoCandidate } from '../../domain/entities/PhotoCandidate';
import {
  FakeMediaLibrary,
  FakeStorageService,
  InMemoryCandidatePhotoRepository,
} from '../../test-support/fakes';

function candidate(id: string): PhotoCandidate {
  return { id, uri: `file:///photos/${id}.jpg`, createdAt: new Date('2026-06-01T00:00:00Z') };
}

function makeSut(photos: PhotoCandidate[]): {
  useCase: SyncCandidatePhotosUseCase;
  storage: FakeStorageService;
  repo: InMemoryCandidatePhotoRepository;
  library: FakeMediaLibrary;
} {
  const library = new FakeMediaLibrary(photos);
  const storage = new FakeStorageService();
  const repo = new InMemoryCandidatePhotoRepository();
  const useCase = new SyncCandidatePhotosUseCase(library, storage, repo);
  return { useCase, storage, repo, library };
}

describe('SyncCandidatePhotosUseCase', () => {
  it('uploads recent photos and persists candidate rows', async () => {
    const { useCase, storage, repo } = makeSut([candidate('a'), candidate('b')]);

    const rows = await useCase.execute('pub-1', 7);

    expect(storage.uploads).toHaveLength(2);
    expect(rows.map(r => r.assetId).sort()).toEqual(['a', 'b']);
    expect(rows.every(r => r.url.startsWith('https://cdn.test/'))).toBe(true);
    expect((await repo.existingAssetIds('pub-1')).size).toBe(2);
  });

  it('scans using the configured lookback window', async () => {
    const { useCase, library } = makeSut([candidate('a')]);
    await useCase.execute('pub-1', 14);
    expect(library.lastLookbackDays).toBe(14);
  });

  it('skips photos already synced (no re-upload)', async () => {
    const { useCase, storage, repo } = makeSut([candidate('a'), candidate('b')]);
    await repo.saveMany([
      { publisherId: 'pub-1', assetId: 'a', url: 'https://cdn.test/a.jpg', createdAt: new Date() },
    ]);

    const rows = await useCase.execute('pub-1', 7);

    expect(rows.map(r => r.assetId)).toEqual(['b']);
    expect(storage.uploads).toHaveLength(1);
    expect(storage.uploads[0]?.filename).toBe('b.jpg');
  });

  it('does nothing when there are no fresh photos', async () => {
    const { useCase, storage } = makeSut([]);
    const rows = await useCase.execute('pub-1', 7);
    expect(rows).toEqual([]);
    expect(storage.uploads).toHaveLength(0);
  });

  it('never runs more than a bounded number of uploads at once (watchdog OOM guard)', async () => {
    const photos = Array.from({ length: 10 }, (_, i) => candidate(`p${i}`));
    const library = new FakeMediaLibrary(photos);
    const repo = new InMemoryCandidatePhotoRepository();

    let inFlight = 0;
    let peak = 0;
    const storage: FakeStorageService = new FakeStorageService();
    const originalUpload = storage.upload.bind(storage);
    storage.upload = async (localUri: string, filename: string): Promise<string> => {
      inFlight += 1;
      peak = Math.max(peak, inFlight);
      // Yield so overlapping uploads actually accumulate before any resolves.
      await Promise.resolve();
      const url = await originalUpload(localUri, filename);
      inFlight -= 1;
      return url;
    };

    const useCase = new SyncCandidatePhotosUseCase(library, storage, repo);
    const rows = await useCase.execute('pub-1', 7);

    expect(rows).toHaveLength(10);
    expect(peak).toBeLessThanOrEqual(3);
  });

  it('persists each batch before the next, so an interrupted sync resumes instead of restarting', async () => {
    const photos = Array.from({ length: 6 }, (_, i) => candidate(`p${i}`));
    const library = new FakeMediaLibrary(photos);
    const repo = new InMemoryCandidatePhotoRepository();
    const storage = new FakeStorageService();

    // Fail partway through the second batch; the first batch must already be saved.
    let count = 0;
    const originalUpload = storage.upload.bind(storage);
    storage.upload = (localUri: string, filename: string): Promise<string> => {
      count += 1;
      if (count === 4) return Promise.reject(new Error('network blip'));
      return originalUpload(localUri, filename);
    };

    const useCase = new SyncCandidatePhotosUseCase(library, storage, repo);
    await expect(useCase.execute('pub-1', 7)).rejects.toThrow('network blip');

    // Batch size 3 → the first batch (3 photos) was committed before the failure.
    expect((await repo.existingAssetIds('pub-1')).size).toBe(3);
  });

  it('resolves the upload uri (e.g. ph:// → file://) before uploading', async () => {
    const library = new FakeMediaLibrary([{ id: 'a', uri: 'ph://a', createdAt: new Date() }]);
    const storage = new FakeStorageService();
    const repo = new InMemoryCandidatePhotoRepository();
    const useCase = new SyncCandidatePhotosUseCase(library, storage, repo, candidate =>
      Promise.resolve(`file:///resolved/${candidate.id}.jpg`),
    );

    await useCase.execute('pub-1', 7);

    expect(storage.uploads[0]?.localUri).toBe('file:///resolved/a.jpg');
  });
});
