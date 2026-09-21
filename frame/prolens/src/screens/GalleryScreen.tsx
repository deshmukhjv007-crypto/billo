import React, { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Image,
  Linking,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as MediaLibrary from 'expo-media-library';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

const PAGE_SIZE = 60;
const COLUMNS = 3;
const GAP = 2;

type PermissionState = 'checking' | 'granted' | 'limited' | 'denied' | 'blocked';

interface GalleryScreenProps {
  onClose: () => void;
}

/**
 * Basic gallery: a grid of the most recent photos from the device library
 * (expo-media-library), tap for full screen. Handles the permission prompt,
 * the "blocked" state (deep-link to Settings), limited access and an empty
 * library.
 */
export function GalleryScreen({ onClose }: GalleryScreenProps) {
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const cell = (width - GAP * (COLUMNS - 1)) / COLUMNS;

  const [permission, setPermission] = useState<PermissionState>('checking');
  const [assets, setAssets] = useState<MediaLibrary.Asset[]>([]);
  const [endCursor, setEndCursor] = useState<string | undefined>(undefined);
  const [hasNextPage, setHasNextPage] = useState(false);
  const [loading, setLoading] = useState(false);
  const [selected, setSelected] = useState<MediaLibrary.Asset | null>(null);

  const applyPermission = useCallback((res: MediaLibrary.PermissionResponse) => {
    if (res.granted) {
      setPermission(res.accessPrivileges === 'limited' ? 'limited' : 'granted');
    } else if (res.canAskAgain) {
      setPermission('denied');
    } else {
      setPermission('blocked');
    }
    return res.granted;
  }, []);

  const loadPage = useCallback(
    async (after?: string) => {
      setLoading(true);
      try {
        const page = await MediaLibrary.getAssetsAsync({
          first: PAGE_SIZE,
          after,
          mediaType: MediaLibrary.MediaType.photo,
          sortBy: [[MediaLibrary.SortBy.creationTime, false]],
        });
        setAssets((prev) => (after ? [...prev, ...page.assets] : page.assets));
        setEndCursor(page.endCursor);
        setHasNextPage(page.hasNextPage);
      } catch (err) {
        console.error('Gallery: failed to load assets', err);
      } finally {
        setLoading(false);
      }
    },
    []
  );

  // Silent check on mount — only prompt when the user taps "Allow".
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await MediaLibrary.getPermissionsAsync(false, ['photo']);
        if (cancelled) return;
        if (applyPermission(res)) await loadPage();
      } catch (err) {
        console.error('Gallery: permission check failed', err);
        if (!cancelled) setPermission('denied');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [applyPermission, loadPage]);

  const requestAccess = useCallback(async () => {
    try {
      const res = await MediaLibrary.requestPermissionsAsync(false, ['photo']);
      if (applyPermission(res)) await loadPage();
    } catch (err) {
      console.error('Gallery: permission request failed', err);
    }
  }, [applyPermission, loadPage]);

  const loadMore = useCallback(() => {
    if (!loading && hasNextPage && endCursor) loadPage(endCursor);
  }, [endCursor, hasNextPage, loadPage, loading]);

  const renderItem = useCallback(
    ({ item, index }: { item: MediaLibrary.Asset; index: number }) => (
      <Pressable
        onPress={() => setSelected(item)}
        accessibilityRole="imagebutton"
        accessibilityLabel={`Photo ${index + 1}`}
        style={{
          width: cell,
          height: cell,
          marginRight: (index + 1) % COLUMNS === 0 ? 0 : GAP,
          marginBottom: GAP,
        }}
      >
        <Image source={{ uri: item.uri }} style={styles.cellImage} />
      </Pressable>
    ),
    [cell]
  );

  return (
    <View style={styles.container}>
      {/* Header */}
      <View style={[styles.header, { paddingTop: insets.top + 6 }]}>
        <Pressable onPress={onClose} style={styles.headerButton} hitSlop={10} accessibilityRole="button">
          <Ionicons name="chevron-back" size={24} color="#fff" />
          <Text style={styles.headerButtonText}>Camera</Text>
        </Pressable>
        <Text style={styles.title}>Gallery</Text>
        <View style={styles.headerButton}>
          {permission === 'limited' && Platform.OS === 'ios' && (
            <Pressable
              onPress={() => MediaLibrary.presentPermissionsPickerAsync().catch(() => {})}
              hitSlop={10}
            >
              <Text style={styles.manageText}>Manage</Text>
            </Pressable>
          )}
        </View>
      </View>

      {/* Body */}
      {permission === 'checking' ? (
        <Centered>
          <ActivityIndicator color="#fff" />
        </Centered>
      ) : permission === 'denied' || permission === 'blocked' ? (
        <Centered>
          <Ionicons name="images-outline" size={44} color="rgba(255,255,255,0.5)" />
          <Text style={styles.emptyTitle}>Photo access needed</Text>
          <Text style={styles.emptyBody}>
            Prolens shows your recent photos here. Nothing is uploaded — everything stays on
            this device.
          </Text>
          {permission === 'denied' ? (
            <Pressable style={styles.primaryButton} onPress={requestAccess}>
              <Text style={styles.primaryButtonText}>Allow photo access</Text>
            </Pressable>
          ) : (
            <Pressable style={styles.primaryButton} onPress={() => Linking.openSettings()}>
              <Text style={styles.primaryButtonText}>Open Settings</Text>
            </Pressable>
          )}
        </Centered>
      ) : assets.length === 0 && !loading ? (
        <Centered>
          <Ionicons name="camera-outline" size={44} color="rgba(255,255,255,0.5)" />
          <Text style={styles.emptyTitle}>No photos yet</Text>
          <Text style={styles.emptyBody}>
            {permission === 'limited'
              ? 'You granted access to selected photos only. Tap Manage to add more.'
              : 'Shots you save from Prolens will show up here.'}
          </Text>
          <Pressable style={styles.primaryButton} onPress={onClose}>
            <Text style={styles.primaryButtonText}>Take a photo</Text>
          </Pressable>
        </Centered>
      ) : (
        <FlatList
          data={assets}
          keyExtractor={(a) => a.id}
          numColumns={COLUMNS}
          renderItem={renderItem}
          onEndReached={loadMore}
          onEndReachedThreshold={0.6}
          contentContainerStyle={{ paddingBottom: insets.bottom + 16 }}
          initialNumToRender={24}
          windowSize={7}
          removeClippedSubviews
          ListFooterComponent={
            loading ? <ActivityIndicator color="#fff" style={styles.footerSpinner} /> : null
          }
        />
      )}

      {/* Full-screen viewer */}
      {selected && (
        <View style={styles.viewer}>
          <Pressable style={StyleSheet.absoluteFill} onPress={() => setSelected(null)}>
            <Image source={{ uri: selected.uri }} style={styles.viewerImage} resizeMode="contain" />
          </Pressable>
          <View style={[styles.viewerTop, { paddingTop: insets.top + 6 }]} pointerEvents="box-none">
            <Pressable
              onPress={() => setSelected(null)}
              style={styles.viewerClose}
              hitSlop={10}
              accessibilityRole="button"
              accessibilityLabel="Close photo"
            >
              <Ionicons name="close" size={24} color="#fff" />
            </Pressable>
          </View>
          <View style={[styles.viewerCaption, { paddingBottom: insets.bottom + 16 }]}>
            <Text style={styles.captionText} numberOfLines={1}>
              {formatDate(selected.creationTime)}
              {selected.width && selected.height ? `  ·  ${selected.width}×${selected.height}` : ''}
            </Text>
          </View>
        </View>
      )}
    </View>
  );
}

function Centered({ children }: { children: React.ReactNode }) {
  return <View style={styles.centered}>{children}</View>;
}

function formatDate(ms: number): string {
  if (!ms) return '';
  const d = new Date(ms);
  return d.toLocaleString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0B0B0E' },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 8,
    paddingBottom: 10,
  },
  headerButton: { width: 96, flexDirection: 'row', alignItems: 'center', justifyContent: 'flex-start' },
  headerButtonText: { color: '#fff', fontSize: 16, fontWeight: '600' },
  title: { color: '#fff', fontSize: 17, fontWeight: '700' },
  manageText: { color: '#0A84FF', fontSize: 15, fontWeight: '600', textAlign: 'right', width: '100%' },
  cellImage: { width: '100%', height: '100%', backgroundColor: '#1C1C1E' },
  footerSpinner: { marginVertical: 16 },
  centered: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 36,
    gap: 10,
  },
  emptyTitle: { color: '#fff', fontSize: 18, fontWeight: '700', marginTop: 6 },
  emptyBody: {
    color: 'rgba(255,255,255,0.6)',
    fontSize: 14,
    lineHeight: 20,
    textAlign: 'center',
  },
  primaryButton: {
    marginTop: 10,
    backgroundColor: '#fff',
    paddingHorizontal: 22,
    paddingVertical: 12,
    borderRadius: 24,
  },
  primaryButtonText: { color: '#000', fontSize: 15, fontWeight: '700' },
  viewer: { ...StyleSheet.absoluteFillObject, backgroundColor: '#000' },
  viewerImage: { width: '100%', height: '100%' },
  viewerTop: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    flexDirection: 'row',
    justifyContent: 'flex-end',
    paddingHorizontal: 14,
  },
  viewerClose: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: 'rgba(0,0,0,0.5)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  viewerCaption: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    alignItems: 'center',
    paddingHorizontal: 20,
  },
  captionText: { color: 'rgba(255,255,255,0.75)', fontSize: 12, fontWeight: '600' },
});
