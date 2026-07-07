import * as Notifications from 'expo-notifications';

/**
 * Registers (and returns) the device's Expo push token so the server can send
 * the empty-batch reminder in autonomous mode. Returns null if the user denies
 * notification permission. Needs a dev/EAS build (not Expo Go) and a projectId.
 */
export async function registerExpoPushToken(projectId: string): Promise<string | null> {
  const current = await Notifications.getPermissionsAsync();
  const granted = current.granted || (await Notifications.requestPermissionsAsync()).granted;
  if (!granted) return null;

  const token = await Notifications.getExpoPushTokenAsync(
    projectId !== '' ? { projectId } : undefined,
  );
  return token.data;
}
