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

  it('threads the resolved GPS coordinate onto each candidate (issue #23)', async () => {
    const library = new FakeMediaLibrary([candidate('a'), candidate('b')]);
    const storage = new FakeStorageService();
    const repo = new InMemoryCandidatePhotoRepository();
    // 'a' is geotagged, 'b' has no fix.
    const useCase = new SyncCandidatePhotosUseCase(library, storage, repo, undefined, c =>
      Promise.resolve(c.id === 'a' ? { latitude: 32.08, longitude: 34.78 } : null),
    );

    const rows = await useCase.execute('pub-1', 7);

    expect(rows.find(r => r.assetId === 'a')?.location).toEqual({ latitude: 32.08, longitude: 34.78 });
    expect(rows.find(r => r.assetId === 'b')?.location).toBeUndefined();
  });

  it('prefers a location already on the candidate over the resolver', async () => {
    const preset = { latitude: 48.85, longitude: 2.35 };
    const library = new FakeMediaLibrary([{ id: 'a', uri: 'file:///a.jpg', createdAt: new Date(), location: preset }]);
    const storage = new FakeStorageService();
    const repo = new InMemoryCandidatePhotoRepository();
    const resolveLocation = jest.fn().mockResolvedValue({ latitude: 0, longitude: 0 });
    const useCase = new SyncCandidatePhotosUseCase(library, storage, repo, undefined, resolveLocation);

    const rows = await useCase.execute('pub-1', 7);

    expect(rows[0]?.location).toEqual(preset);
    expect(resolveLocation).not.toHaveBeenCalled();
  });
});
