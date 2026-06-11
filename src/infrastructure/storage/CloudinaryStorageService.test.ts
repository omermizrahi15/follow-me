jest.mock('expo-file-system/legacy', () => ({
  readAsStringAsync: jest.fn(),
  EncodingType: { Base64: 'base64' },
}));

import { CloudinaryStorageService } from './CloudinaryStorageService';
import * as FileSystem from 'expo-file-system/legacy';

const mockRead = FileSystem.readAsStringAsync as jest.Mock;
const mockFetch = jest.fn();
(global as unknown as Record<string, unknown>).fetch = mockFetch;

let lastFormData: Map<string, string>;
class MockFormData {
  constructor() { lastFormData = new Map(); }
  append(key: string, value: string): void { lastFormData.set(key, value); }
}
(global as unknown as Record<string, unknown>).FormData = MockFormData;

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
  mockRead.mockReset();
  mockRead.mockResolvedValue('abc123==');
});

describe('CloudinaryStorageService — upload endpoint routing', () => {
  it('uses /image/upload for JPEG', async () => {
    mockSuccess();
    await makeSut().upload('file:///photo.jpg', 'photo.jpg');
    expect(mockFetch).toHaveBeenCalledWith(
      'https://api.cloudinary.com/v1_1/my-cloud/image/upload',
      expect.anything(),
    );
  });

  it('uses /image/upload for PNG', async () => {
    mockSuccess();
    await makeSut().upload('file:///photo.png', 'photo.png');
    expect(mockFetch).toHaveBeenCalledWith(
      expect.stringContaining('/image/upload'),
      expect.anything(),
    );
  });

  it('uses /video/upload for MP4', async () => {
    mockSuccess();
    await makeSut().upload('file:///clip.mp4', 'clip.mp4');
    expect(mockFetch).toHaveBeenCalledWith(
      'https://api.cloudinary.com/v1_1/my-cloud/video/upload',
      expect.anything(),
    );
  });

  it('uses /video/upload for MOV', async () => {
    mockSuccess();
    await makeSut().upload('file:///clip.mov', 'clip.mov');
    expect(mockFetch).toHaveBeenCalledWith(
      expect.stringContaining('/video/upload'),
      expect.anything(),
    );
  });
});

describe('CloudinaryStorageService — MIME type in data URI', () => {
  const cases: Array<[string, string]> = [
    ['photo.jpg', 'image/jpeg'],
    ['photo.jpeg', 'image/jpeg'],
    ['photo.png', 'image/png'],
    ['photo.PNG', 'image/png'],
    ['photo.gif', 'image/gif'],
    ['photo.webp', 'image/webp'],
    ['clip.mp4', 'video/mp4'],
    ['clip.mov', 'video/mp4'],
    ['clip.avi', 'video/mp4'],
    ['unknown.xyz', 'image/jpeg'],
    ['noextension', 'image/jpeg'],
  ];

  it.each(cases)('%s → data URI starts with data:%s', async (filename, mimeType) => {
    mockSuccess();
    await makeSut().upload('file:///media', filename);
    expect(lastFormData.get('file')).toBe(`data:${mimeType};base64,abc123==`);
  });
});

describe('CloudinaryStorageService — FormData payload', () => {
  it('embeds the base64 content from FileSystem in the data URI', async () => {
    mockRead.mockResolvedValue('realbase64content==');
    mockSuccess();
    await makeSut().upload('file:///photo.jpg', 'photo.jpg');
    expect(lastFormData.get('file')).toBe('data:image/jpeg;base64,realbase64content==');
  });

  it('includes the upload preset', async () => {
    mockSuccess();
    await makeSut().upload('file:///photo.jpg', 'photo.jpg');
    expect(lastFormData.get('upload_preset')).toBe('my-preset');
  });

  it('sends a POST request', async () => {
    mockSuccess();
    await makeSut().upload('file:///photo.jpg', 'photo.jpg');
    expect(mockFetch).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({ method: 'POST' }));
  });
});

describe('CloudinaryStorageService — FileSystem usage', () => {
  it('reads the localUri with Base64 encoding', async () => {
    mockSuccess();
    await makeSut().upload('file:///my-photo.jpg', 'photo.jpg');
    expect(mockRead).toHaveBeenCalledWith('file:///my-photo.jpg', { encoding: 'base64' });
  });
});

describe('CloudinaryStorageService — response handling', () => {
  it('returns the secure_url on success', async () => {
    mockSuccess('https://res.cloudinary.com/my-cloud/image/upload/v1/photo.jpg');
    const url = await makeSut().upload('file:///photo.jpg', 'photo.jpg');
    expect(url).toBe('https://res.cloudinary.com/my-cloud/image/upload/v1/photo.jpg');
  });

  it('throws with status and body on API error', async () => {
    mockFailure(400, '{"error":{"message":"Unsupported source URL"}}');
    await expect(makeSut().upload('file:///photo.jpg', 'photo.jpg'))
      .rejects.toThrow('Cloudinary upload failed (400): {"error":{"message":"Unsupported source URL"}}');
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
