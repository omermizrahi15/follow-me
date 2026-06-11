const mockFetch = jest.fn();
(global as unknown as Record<string, unknown>).fetch = mockFetch;

let lastFormData: Map<string, unknown>;
class MockFormData {
  constructor() { lastFormData = new Map(); }
  append(key: string, value: unknown): void { lastFormData.set(key, value); }
}
(global as unknown as Record<string, unknown>).FormData = MockFormData;

import { CloudinaryStorageService } from './CloudinaryStorageService';

function makeSut(): CloudinaryStorageService {
  return new CloudinaryStorageService('my-cloud', 'my-preset');
}

function mockSuccess(secureUrl = 'https://res.cloudinary.com/test/photo.jpg'): void {
  mockFetch.mockResolvedValueOnce({
    ok: true,
    json: () => Promise.resolve({ secure_url: secureUrl }),
  });
}

function mockFailure(status: number, body: string): void {
  mockFetch.mockResolvedValueOnce({ ok: false, status, text: () => Promise.resolve(body) });
}

beforeEach(() => {
  mockFetch.mockReset();
});

describe('CloudinaryStorageService — upload endpoint', () => {
  it('posts to the correct Cloudinary URL', async () => {
    mockSuccess();
    await makeSut().upload('file:///photo.jpg', 'photo.jpg');
    expect(mockFetch).toHaveBeenCalledWith(
      'https://api.cloudinary.com/v1_1/my-cloud/image/upload',
      expect.objectContaining({ method: 'POST' }),
    );
  });

  it('includes the upload preset in the form data', async () => {
    mockSuccess();
    await makeSut().upload('file:///photo.jpg', 'photo.jpg');
    expect(lastFormData.get('upload_preset')).toBe('my-preset');
  });

  it('includes the file in the form data', async () => {
    mockSuccess();
    await makeSut().upload('file:///photo.jpg', 'photo.jpg');
    expect(lastFormData.has('file')).toBe(true);
  });
});

describe('CloudinaryStorageService — response handling', () => {
  it('returns the secure_url on success', async () => {
    mockSuccess('https://res.cloudinary.com/my-cloud/image/upload/v1/photo.jpg');
    const url = await makeSut().upload('file:///photo.jpg', 'photo.jpg');
    expect(url).toBe('https://res.cloudinary.com/my-cloud/image/upload/v1/photo.jpg');
  });

  it('throws with status and body on API error', async () => {
    mockFailure(400, '{"error":{"message":"Bad request"}}');
    await expect(makeSut().upload('file:///photo.jpg', 'photo.jpg'))
      .rejects.toThrow('Cloudinary upload failed (400)');
  });

  it('throws with the status code on auth error', async () => {
    mockFailure(401, 'Unauthorized');
    await expect(makeSut().upload('file:///photo.jpg', 'photo.jpg')).rejects.toThrow('401');
  });

  it('throws with the status code on rate limit', async () => {
    mockFailure(429, 'Too Many Requests');
    await expect(makeSut().upload('file:///photo.jpg', 'photo.jpg')).rejects.toThrow('429');
  });
});
