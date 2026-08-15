import { SyncCandidatePhotosUseCase } from './SyncCandidatePhotosUseCase';
import type { PhotoCandidate } from '../../domain/entities/PhotoCandidate';
import {
  FakeMediaLibrary,
  FakeStorageService,
  FakeSentPhotoTracker,
  InMemoryCandidatePhotoRepository,
} from '../../test-support/fakes';

// Inside the window the sync now asks for, which is anchored to the clock (see
// `windowStartMs`) rather than being whatever the fake was seeded with.
function candidate(id: string): PhotoCandidate {
  return {
    id,
    uri: `file:///photos/${id}.jpg`,
    createdAt: new Date(Date.now() - 24 * 60 * 60 * 1000),
  };
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
    const start = library.requestedWindows[0]!.start.getTime();
    expect(Math.round((Date.now() - start) / (24 * 60 * 60 * 1000))).toBe(14);
  });

  it('reaches back to the last post, so the cloud covers what the phone offers', async () => {
    // The suggestion scan already extends its window for an overdue publisher.
    // While this one did not, the phone showed those photos and the server's
    // autonomous post could not see them.
    const library = new FakeMediaLibrary([candidate('a')]);
    const nineDaysAgo = new Date(Date.now() - 9 * 24 * 60 * 60 * 1000);
    const useCase = new SyncCandidatePhotosUseCase(
      library,
      new FakeStorageService(),
      new InMemoryCandidatePhotoRepository(),
      undefined,
      undefined,
      new FakeSentPhotoTracker(new Set(), nineDaysAgo),
    );

    await useCase.execute('pub-1', 7);

    const start = library.requestedWindows[0]!.start.getTime();
    expect(Math.round((Date.now() - start) / (24 * 60 * 60 * 1000))).toBe(9);
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

  // The crash breadcrumbs for issue #77 show the user wiping their cloud photos
  // while a sync was running. Without this the in-flight batches commit after
  // the delete and the cloud set quietly comes back.
  it('abandons an in-flight sync once the cloud is wiped', async () => {
    const photos = Array.from({ length: 9 }, (_, i) => candidate(`p${i}`));
    const library = new FakeMediaLibrary(photos);
    const repo = new InMemoryCandidatePhotoRepository();
    const storage = new FakeStorageService();

    // The wipe lands after the first batch has been uploaded and saved.
    let wiped = false;
    const originalUpload = storage.upload.bind(storage);
    storage.upload = async (localUri: string, filename: string): Promise<string> => {
      const url = await originalUpload(localUri, filename);
      if (storage.uploads.length >= 3) wiped = true;
      return url;
    };

    const useCase = new SyncCandidatePhotosUseCase(library, storage, repo);
    const rows = await useCase.execute('pub-1', 7, () => Promise.resolve(wiped));

    expect(rows).toHaveLength(3);
    expect(storage.uploads).toHaveLength(3);
  });

  it('syncs everything when nothing asks it to stop', async () => {
    const photos = Array.from({ length: 9 }, (_, i) => candidate(`p${i}`));
    const { useCase } = makeSut(photos);

    const rows = await useCase.execute('pub-1', 7, () => Promise.resolve(false));

    expect(rows).toHaveLength(9);
  });

  it('resolves the upload uri (e.g. ph:// → file://) before uploading', async () => {
    const library = new FakeMediaLibrary([{ id: 'a', uri: 'ph://a', createdAt: candidate('a').createdAt }]);
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
    const library = new FakeMediaLibrary([{ id: 'a', uri: 'file:///a.jpg', createdAt: candidate('a').createdAt, location: preset }]);
    const storage = new FakeStorageService();
    const repo = new InMemoryCandidatePhotoRepository();
    const resolveLocation = jest.fn().mockResolvedValue({ latitude: 0, longitude: 0 });
    const useCase = new SyncCandidatePhotosUseCase(library, storage, repo, undefined, resolveLocation);

    const rows = await useCase.execute('pub-1', 7);

    expect(rows[0]?.location).toEqual(preset);
    expect(resolveLocation).not.toHaveBeenCalled();
  });

  describe('progress reporting', () => {
    // A first sync over a wide lookback is minutes of work at three photos at a
    // time. Without progress the UI has only a spinner to show for it, which is
    // how a working sync got mistaken for a hung one and force-quit halfway.
    it('reports 0-of-total before the first upload, then after each committed batch', async () => {
      const { useCase } = makeSut(['a', 'b', 'c', 'd'].map(candidate));
      const progress: [number, number][] = [];

      await useCase.execute('pub-1', 7, undefined, (uploaded, total) =>
        progress.push([uploaded, total]),
      );

      // Batch size is 3, so: the opening report, then 3, then the last one.
      expect(progress).toEqual([
        [0, 4],
        [3, 4],
        [4, 4],
      ]);
    });

    it('counts only photos that still need uploading, not the whole library', async () => {
      const { useCase } = makeSut([candidate('a'), candidate('b')]);
      await useCase.execute('pub-1', 7);

      const progress: [number, number][] = [];
      await useCase.execute('pub-1', 7, undefined, (uploaded, total) =>
        progress.push([uploaded, total]),
      );

      // Everything is already synced — "0 of 0", not "0 of 2". A total that
      // counts already-uploaded photos would show a bar that never fills.
      expect(progress).toEqual([[0, 0]]);
    });

    it('reports progress even when there is nothing to do, so the caller can tell it finished', async () => {
      const { useCase } = makeSut([]);
      const progress: [number, number][] = [];

      await useCase.execute('pub-1', 7, undefined, (uploaded, total) =>
        progress.push([uploaded, total]),
      );

      expect(progress).toEqual([[0, 0]]);
    });

    it('reports only what was committed when the run is stopped early', async () => {
      const { useCase } = makeSut(['a', 'b', 'c', 'd', 'e', 'f'].map(candidate));
      const progress: [number, number][] = [];
      // Stop once anything has been committed — the shape of a cloud wipe
      // landing mid-sync, or an iOS background window expiring.
      let committed = false;

      await useCase.execute(
        'pub-1',
        7,
        () => Promise.resolve(committed),
        (uploaded, total) => {
          if (uploaded > 0) committed = true;
          progress.push([uploaded, total]);
        },
      );

      // The opening report, then whatever landed before the stop — always
      // fewer than all six, and never a count that goes backwards.
      const uploaded = progress.map(([n]) => n);
      expect(progress[0]).toEqual([0, 6]);
      expect(progress.length).toBeGreaterThan(1);
      expect(uploaded.at(-1)).toBeLessThan(6);
      expect([...uploaded].sort((a, b) => a - b)).toEqual(uploaded);
    });
  });
});
