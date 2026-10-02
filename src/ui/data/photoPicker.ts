import * as ImagePicker from 'expo-image-picker';

/**
 * Opens the system photo picker for a multi-photo selection. Resolves with the
 * picked assets, or null when permission is denied or the publisher cancels.
 *
 * The picker is asked for the original file (`Current`) with no `quality`:
 * the default representation mode transcodes HEIC to JPEG and a `quality` below
 * 1 re-encodes every photo, all before this promise resolves — a delay of
 * seconds on a large selection. Upload downscales and re-encodes each photo
 * itself (CloudinaryStorageService), so that work was being done twice.
 */
export async function pickPhotosFromLibrary(): Promise<ImagePicker.ImagePickerAsset[] | null> {
  const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
  if (!permission.granted) return null;
  const picked = await ImagePicker.launchImageLibraryAsync({
    mediaTypes: ImagePicker.MediaTypeOptions.Images,
    allowsMultipleSelection: true,
    preferredAssetRepresentationMode: ImagePicker.UIImagePickerPreferredAssetRepresentationMode.Current,
    // EXIF carries the photos' GPS — it names the posting's place in the feed.
    exif: true,
  });
  return picked.canceled ? null : picked.assets;
}
