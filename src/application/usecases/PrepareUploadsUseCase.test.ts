import { PrepareUploadsUseCase } from './PrepareUploadsUseCase';
import type { PhotoCandidate } from '../../domain/entities/PhotoCandidate';
import type { IStorageService } from '../../domain/interfaces';

function makeSut(opts: { prepare?: IStorageService['prepare'] } = {}): {
  sut: PrepareUploadsUseCase;
  prepare: jest.Mock;
  resolve: jest.Mock;
} {
  const prepare = jest.fn().mockResolvedValue(undefined);
  const resolve = jest.fn((c: PhotoCandidate) => Promise.resolve(c.uri.replace('ph://', 'file:///resolved/')));
  const storage: IStorageService = {
    upload: jest.fn(),
    ...(opts.prepare !== undefined ? { prepare: opts.prepare } : { prepare }),
  };
  return { sut: new PrepareUploadsUseCase(storage, resolve), prepare, resolve };
}

const photo = (id: string, uri: string): PhotoCandidate => ({ id, uri, createdAt: new Date(0) });

describe('PrepareUploadsUseCase', () => {
  it('resolves library handles to files, then prepares each one', async () => {
    const { sut, prepare } = makeSut();
    await sut.execute([photo('a', 'ph://A'), photo('b', 'ph://B')]);
    expect(prepare).toHaveBeenCalledWith('file:///resolved/A', 'A');
    expect(prepare).toHaveBeenCalledWith('file:///resolved/B', 'B');
  });

  it('does not touch photos that are already hosted remotely', async () => {
    const { sut, prepare, resolve } = makeSut();
    await sut.execute([photo('a', 'https://cdn/x.jpg')]);
    expect(resolve).not.toHaveBeenCalled();
    expect(prepare).not.toHaveBeenCalled();
  });

  it('skips a photo it cannot resolve without failing the rest', async () => {
    const { sut, prepare, resolve } = makeSut();
    resolve.mockRejectedValueOnce(new Error('icloud offline'));
    await sut.execute([photo('a', 'ph://A'), photo('b', 'ph://B')]);
    expect(prepare).toHaveBeenCalledTimes(1);
    expect(prepare).toHaveBeenCalledWith('file:///resolved/B', 'B');
  });

  it('is a no-op when the storage has nothing to prepare', async () => {
    const storage: IStorageService = { upload: jest.fn() };
    const resolve = jest.fn();
    await expect(new PrepareUploadsUseCase(storage, resolve).execute([photo('a', 'ph://A')])).resolves.toBeUndefined();
    expect(resolve).not.toHaveBeenCalled();
  });

  it('prepares at most PHOTO_UPLOAD_BATCH_SIZE photos at once', async () => {
    let running = 0;
    let peak = 0;
    const { sut } = makeSut({
      prepare: async () => {
        running++;
        peak = Math.max(peak, running);
        await new Promise(r => setTimeout(r, 1));
        running--;
      },
    });
    await sut.execute(Array.from({ length: 20 }, (_, i) => photo(`p${i}`, `ph://P${i}`)));
    expect(peak).toBeLessThanOrEqual(6);
  });
});
