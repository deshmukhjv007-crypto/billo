import React from 'react';
import { Image, Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

export interface BottomBarProps {
  /** Most recent capture (file:// or ph:// / content:// URI) for the thumbnail. */
  lastPhotoUri?: string;
  onOpenGallery: () => void;
  onFlipCamera: () => void;
  flipAvailable: boolean;
  onShutter: () => void;
  /** Composition is in the sweet spot → green ring on the shutter. */
  ready: boolean;
  /** Disables the shutter while a capture is in flight. */
  capturing?: boolean;
  /** User-facing zoom factors to offer, e.g. [0.5, 1, 2]. */
  zoomOptions: number[];
  /** Currently selected user-facing zoom factor. */
  zoom: number;
  onSelectZoom: (factor: number) => void;
}

/**
 * Safe-area bottom chrome, thumb-reachable:
 *
 *        [0.5] [1×] [2]        ← zoom chips
 *   [thumb]   ( ◉ )   [flip]   ← gallery · shutter · camera flip
 */
function BottomBarImpl({
  lastPhotoUri,
  onOpenGallery,
  onFlipCamera,
  flipAvailable,
  onShutter,
  ready,
  capturing = false,
  zoomOptions,
  zoom,
  onSelectZoom,
}: BottomBarProps) {
  const insets = useSafeAreaInsets();

  return (
    <View
      style={[styles.container, { paddingBottom: insets.bottom + 18 }]}
      pointerEvents="box-none"
    >
      {/* Zoom chips */}
      {zoomOptions.length > 1 && (
        <View style={styles.zoomRow}>
          {zoomOptions.map((z) => {
            const selected = Math.abs(z - zoom) < 0.01;
            return (
              <Pressable
                key={z}
                accessibilityRole="button"
                accessibilityState={{ selected }}
                accessibilityLabel={`Zoom ${z}x`}
                onPress={() => {
                  if (selected) return;
                  Haptics.selectionAsync().catch(() => {});
                  onSelectZoom(z);
                }}
                style={[styles.zoomChip, selected && styles.zoomChipSelected]}
                hitSlop={6}
              >
                <Text style={[styles.zoomText, selected && styles.zoomTextSelected]}>
                  {formatZoom(z)}
                  {selected ? '×' : ''}
                </Text>
              </Pressable>
            );
          })}
        </View>
      )}

      {/* Main row */}
      <View style={styles.row}>
        {/* Last photo → gallery */}
        <View style={styles.side}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Open gallery"
            onPress={() => {
              Haptics.selectionAsync().catch(() => {});
              onOpenGallery();
            }}
            style={({ pressed }) => [styles.thumb, pressed && styles.pressed]}
            hitSlop={8}
          >
            {lastPhotoUri ? (
              <Image source={{ uri: lastPhotoUri }} style={styles.thumbImage} />
            ) : (
              <Ionicons name="images-outline" size={22} color="rgba(255,255,255,0.9)" />
            )}
          </Pressable>
        </View>

        {/* Shutter */}
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Take photo"
          disabled={capturing}
          onPress={onShutter}
          style={({ pressed }) => [
            styles.shutterRing,
            ready && styles.shutterRingReady,
            pressed && styles.shutterPressed,
            capturing && styles.shutterBusy,
          ]}
        >
          <View style={styles.shutterInner} />
        </Pressable>

        {/* Flip */}
        <View style={[styles.side, styles.sideRight]}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Flip camera"
            disabled={!flipAvailable}
            onPress={() => {
              Haptics.selectionAsync().catch(() => {});
              onFlipCamera();
            }}
            style={({ pressed }) => [
              styles.round,
              !flipAvailable && styles.disabled,
              pressed && styles.pressed,
            ]}
            hitSlop={8}
          >
            <Ionicons name="camera-reverse-outline" size={26} color="rgba(255,255,255,0.95)" />
          </Pressable>
        </View>
      </View>
    </View>
  );
}

function formatZoom(z: number): string {
  return Number.isInteger(z) ? `${z}` : `${z}`.replace(/^0/, '');
}

export const BottomBar = React.memo(BottomBarImpl);

const SHUTTER = 78;
const SHUTTER_INNER = 62;
const ROUND = 48;

const styles = StyleSheet.create({
  container: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    alignItems: 'center',
  },
  zoomRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 18,
    paddingHorizontal: 6,
    paddingVertical: 5,
    borderRadius: 24,
    backgroundColor: 'rgba(0,0,0,0.35)',
  },
  zoomChip: {
    minWidth: 32,
    height: 32,
    paddingHorizontal: 6,
    borderRadius: 16,
    backgroundColor: 'rgba(0,0,0,0.5)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  zoomChipSelected: {
    minWidth: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: 'rgba(0,0,0,0.7)',
  },
  zoomText: {
    color: 'rgba(255,255,255,0.85)',
    fontSize: 12,
    fontWeight: '700',
    includeFontPadding: false,
  },
  zoomTextSelected: { color: '#FFD60A', fontSize: 13 },
  row: {
    width: '100%',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 28,
  },
  side: { flex: 1, alignItems: 'flex-start' },
  sideRight: { alignItems: 'flex-end' },
  thumb: {
    width: ROUND,
    height: ROUND,
    borderRadius: 12,
    backgroundColor: 'rgba(0,0,0,0.45)',
    borderWidth: 1.5,
    borderColor: 'rgba(255,255,255,0.75)',
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'center',
  },
  thumbImage: { width: '100%', height: '100%' },
  round: {
    width: ROUND,
    height: ROUND,
    borderRadius: ROUND / 2,
    backgroundColor: 'rgba(0,0,0,0.45)',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(255,255,255,0.3)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  disabled: { opacity: 0.35 },
  pressed: { opacity: 0.6 },
  shutterRing: {
    width: SHUTTER,
    height: SHUTTER,
    borderRadius: SHUTTER / 2,
    borderWidth: 4,
    borderColor: 'rgba(255,255,255,0.95)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  shutterRingReady: {
    borderColor: '#00FF88',
    shadowColor: '#00FF88',
    shadowOpacity: 0.85,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: 0 },
  },
  shutterInner: {
    width: SHUTTER_INNER,
    height: SHUTTER_INNER,
    borderRadius: SHUTTER_INNER / 2,
    backgroundColor: 'white',
  },
  shutterPressed: { transform: [{ scale: 0.92 }] },
  shutterBusy: { opacity: 0.5 },
});
