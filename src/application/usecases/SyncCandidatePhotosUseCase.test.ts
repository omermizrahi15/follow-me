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
