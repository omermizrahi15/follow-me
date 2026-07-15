import { useEffect, useState } from 'react';
import { Keyboard, Platform } from 'react-native';
import type { KeyboardEvent } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

/**
 * Bottom padding that keeps a footer input above the keyboard.
 *
 * Exists because KeyboardAvoidingView mis-measures inside pageSheet modals
 * (presentation: 'modal'): it offsets by its own layout frame, which excludes
 * the sheet's top gap, so it under-pads by that gap and the input stays
 * covered. Keyboard height from the native event needs no frame math, so it
 * works in sheets and full-screen alike. The safe-area bottom inset is
 * subtracted because the screen already pads it while the keyboard replaces it.
 */
export function useKeyboardBottomPadding(): number {
  const [keyboardHeight, setKeyboardHeight] = useState(0);
  const insets = useSafeAreaInsets();

  useEffect(() => {
    // iOS "will" events animate alongside the keyboard; Android only has "did".
    const showEvent = Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow';
    const hideEvent = Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide';
    const show = Keyboard.addListener(showEvent, (e: KeyboardEvent) =>
      setKeyboardHeight(e.endCoordinates.height),
    );
    const hide = Keyboard.addListener(hideEvent, () => setKeyboardHeight(0));
    return () => {
      show.remove();
      hide.remove();
    };
  }, []);

  return Math.max(0, keyboardHeight - insets.bottom);
}
