import * as ImagePicker from 'expo-image-picker';
import { pickPhotosFromLibrary } from './photoPicker';

jest.mock('expo-image-picker', () => ({
  requestMediaLibraryPermissionsAsync: jest.fn(),
  launchImageLibraryAsync: jest.fn(),
  MediaTypeOptions: { Images: 'Images' },
  UIImagePickerPreferredAssetRepresentationMode: { Current: 'current' },
}));

const requestPermission = ImagePicker.requestMediaLibraryPermissionsAsync as jest.Mock;
const launch = ImagePicker.launchImageLibraryAsync as jest.Mock;

beforeEach(() => {
  jest.clearAllMocks();
  requestPermission.mockResolvedValue({ granted: true });
});

describe('pickPhotosFromLibrary', () => {
  it('returns the picked assets', async () => {
    const assets = [{ uri: 'file:///a.heic' }, { uri: 'file:///b.heic' }];
    launch.mockResolvedValue({ canceled: false, assets });
    await expect(pickPhotosFromLibrary()).resolves.toEqual(assets);
  });

  it('returns null when the publisher cancels', async () => {
    launch.mockResolvedValue({ canceled: true, assets: null });
    await expect(pickPhotosFromLibrary()).resolves.toBeNull();
  });

  it('returns null without opening the picker when permission is denied', async () => {
    requestPermission.mockResolvedValue({ granted: false });
    await expect(pickPhotosFromLibrary()).resolves.toBeNull();
    expect(launch).not.toHaveBeenCalled();
  });

  // The upload step already downscales and re-encodes every photo to JPEG, so
  // asking the picker to transcode too is pure delay between the selection and
  // the photos appearing (issue #199).
  it('asks the picker for the original file, not a transcoded copy', async () => {
    launch.mockResolvedValue({ canceled: true, assets: null });
    await pickPhotosFromLibrary();
    const [options] = launch.mock.calls[0] as [Record<string, unknown>];
    expect(options.preferredAssetRepresentationMode).toBe('current');
    expect(options.quality).toBeUndefined();
    expect(options.allowsMultipleSelection).toBe(true);
    // EXIF carries the photos' GPS — it names the posting's place in the feed.
    expect(options.exif).toBe(true);
  });
});
