import React, { useEffect, useMemo, useRef, useState } from 'react';
import { View, Text, ActivityIndicator, StyleSheet } from 'react-native';
import { WebView, type WebViewMessageEvent } from 'react-native-webview';
import type { FeedPosting } from '../data/feed';
import { displaySizedUri } from '../../domain/services/mediaDisplayUri';
import { buildTravelRoute, type TravelRouteInput } from '../../domain/services/travelRoute';
import { buildGlobeHtml, toScriptLiteral, type GlobeMessage } from './globeHtml';
import { globeStyleUrl } from './styleUrl';
import { colors, spacing } from '../theme/theme';

interface Props {
  postings: FeedPosting[];
  /** Tapping a photo marker opens that posting. */
  onPressPosting: (posting: FeedPosting) => void;
  /** Height of the bottom sheet, so the globe centres in the visible band. */
  bottomPadding: number;
}

/**
 * Markers are 54 CSS px; ask the CDN for a 2×-density square and nothing more.
 * Full-size covers here would be the same mistake that produced the launch
 * watchdog kills — a route of 100 stops must not pull 100 camera-resolution
 * photos into the WebView.
 */
const MARKER_PX = 108;

/**
 * Hosts the map page is allowed to reach: our own generated document, the
 * pinned MapLibre build, the tile provider, and the photo CDN. Anything else —
 * an attribution link, a redirect — is refused rather than loaded in place of
 * the globe. Subresources (scripts, tiles, images) are not navigations and are
 * unaffected by this check on either platform; it is the navigation guard.
 */
const ALLOWED_HOSTS = [
  'localhost',
  'unpkg.com',
  'api.maptiler.com',
  'demotiles.maplibre.org',
  'res.cloudinary.com',
];

/** Feed posting → what the route builder needs, with a marker-sized thumbnail. */
function toRouteInput(posting: FeedPosting): TravelRouteInput {
  const cover = posting.coverUri ?? posting.media.find(m => m.uri)?.uri;
  return {
    id: posting.id,
    createdAt: posting.createdAt,
    date: posting.date,
    thumbUrl: cover != null ? displaySizedUri(cover, MARKER_PX) : null,
    ...(posting.coordinate != null ? { coordinate: posting.coordinate } : {}),
    ...(posting.place != null ? { place: posting.place } : {}),
  };
}

export function isAllowedUrl(url: string): boolean {
  const match = /^https:\/\/([^/?#]+)/i.exec(url);
  if (match == null) return false;
  const host = (match[1] as string).toLowerCase().split(':')[0] as string;
  return ALLOWED_HOSTS.includes(host);
}

/**
 * The travel map behind the Me sheet: a 3D globe with one photo marker per
 * posting, joined in chronological order by a dashed great-circle route with a
 * plane on each leg.
 *
 * Rendered by MapLibre GL JS inside a WebView because globe projection does not
 * exist in MapLibre Native — see the note in globeHtml.ts.
 */
export function RouteGlobe({ postings, onPressPosting, bottomPadding }: Props): React.JSX.Element {
  const [ready, setReady] = useState(false);
  const webRef = useRef<WebView>(null);
  // The page only ever sends back an id — it holds the route, not the
  // postings — so a tap has to be resolved against the current list here.
  //
  // Derived, not a ref written during render: a render is allowed to be
  // discarded, and an assignment inside one is a side effect that would
  // survive it. Under concurrent rendering that means a lookup table built
  // from postings React ended up throwing away.
  const byId = useMemo(() => new Map(postings.map(p => [p.id, p])), [postings]);

  // The route as a JS literal, ready either to bake into the page or to push
  // into the live one. Comparing these strings is also how "did the route
  // actually change?" is answered: `postings` is a fresh array on every feed
  // reload even when it holds exactly the same posts.
  const routeLiteral = useMemo(
    () => toScriptLiteral(buildTravelRoute(postings.map(toRouteInput))),
    [postings],
  );

  // Built ONCE, on the first render, and never again. The WebView reloads the
  // whole document whenever its source changes — new MapLibre, new style
  // fetch, every tile and thumbnail again, and the boot sequence visible — so
  // keying the HTML on `postings` meant the entire globe was torn down and
  // rebuilt on every focus and after every delete. That was the flash. Both
  // things that can change afterwards (the route, the sheet height) are now
  // pushed into the running page instead, by the two effects below.
  const [source] = useState(() => ({
    html: buildGlobeHtml({ routeLiteral, styleUrl: globeStyleUrl(), bottomPadding }),
    baseUrl: 'https://localhost',
  }));

  // What the page was built with, so a document that reloads itself can be
  // brought back up to date — see handleMessage.
  const bakedRoute = useRef(routeLiteral);
  const bakedPadding = useRef(bottomPadding);
  const sentRoute = useRef(routeLiteral);
  const sentPadding = useRef(bottomPadding);

  useEffect(() => {
    if (routeLiteral === sentRoute.current) return;
    sentRoute.current = routeLiteral;
    // Before the page has loaded this is buffered inside it, so there is no
    // need to wait for `ready` here.
    webRef.current?.injectJavaScript(`window.__setRoute(${routeLiteral});true;`);
  }, [routeLiteral]);

  useEffect(() => {
    if (bottomPadding === sentPadding.current) return;
    sentPadding.current = bottomPadding;
    webRef.current?.injectJavaScript(`window.__setBottomPadding(${Math.round(bottomPadding)});true;`);
  }, [bottomPadding]);

  function handleMessage(event: WebViewMessageEvent): void {
    let message: GlobeMessage;
    try {
      message = JSON.parse(event.nativeEvent.data) as GlobeMessage;
    } catch {
      return; // Not ours — ignore rather than crash the screen.
    }
    if (message.type === 'ready') {
      setReady(true);
      // WebKit can reclaim a backgrounded content process and reload the
      // document by itself, which drops the page back to whatever was baked
      // into it at mount. Anything that has moved on since is re-pushed here.
      if (routeLiteral !== bakedRoute.current) {
        webRef.current?.injectJavaScript(`window.__setRoute(${routeLiteral});true;`);
      }
      if (bottomPadding !== bakedPadding.current) {
        webRef.current?.injectJavaScript(`window.__setBottomPadding(${Math.round(bottomPadding)});true;`);
      }
    }
    if (message.type === 'error') {
      // A blank globe otherwise looks like a hang; at least say so in dev.
      if (__DEV__) console.warn('[globe]', message.message);
    }
    if (message.type === 'openPosting') {
      const posting = byId.get(message.id);
      if (posting != null) onPressPosting(posting);
    }
  }

  const plotted = postings.filter(p => p.coordinate != null).length;

  return (
    <View style={styles.container}>
      <WebView
        ref={webRef}
        testID="route-globe"
        style={styles.web}
        // The page is generated locally; a base URL is still needed so the CDN
        // and tile requests are not treated as cross-origin from about:blank.
        source={source}
        originWhitelist={['https://*']}
        onMessage={handleMessage}
        javaScriptEnabled
        domStorageEnabled
        // The globe is the background: it must never bounce or show a white
        // overscroll edge behind the sheet.
        bounces={false}
        overScrollMode="never"
        scrollEnabled={false}
        allowsInlineMediaPlayback
        setSupportMultipleWindows={false}
        // The WebView renders our map document and nothing else: a tap on an
        // attribution link must not turn the app's background into a browser.
        onShouldStartLoadWithRequest={request => isAllowedUrl(request.url)}
      />
      {!ready && (
        <View style={styles.loading} pointerEvents="none">
          <ActivityIndicator color="#fff" />
        </View>
      )}
      {ready && plotted === 0 && postings.length > 0 && (
        <View style={styles.notice} pointerEvents="none">
          <Text style={styles.noticeText}>
            None of your posts have a location yet — new posts with photo GPS will appear here.
          </Text>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  // Deep space, matching the page background so there is no flash on load.
  container: { ...StyleSheet.absoluteFillObject, backgroundColor: '#0b1a2b' },
  web: { flex: 1, backgroundColor: '#0b1a2b' },
  loading: { ...StyleSheet.absoluteFillObject, alignItems: 'center', justifyContent: 'center' },
  notice: {
    position: 'absolute',
    left: spacing.xl,
    right: spacing.xl,
    top: '38%',
    backgroundColor: 'rgba(11,26,43,0.75)',
    borderRadius: 14,
    padding: spacing.lg,
  },
  noticeText: { color: colors.onAccent, fontSize: 14, textAlign: 'center', lineHeight: 20 },
});
