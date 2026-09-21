import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

export type FlashMode = 'off' | 'on' | 'auto';

export const FLASH_CYCLE: Record<FlashMode, FlashMode> = {
  off: 'on',
  on: 'auto',
  auto: 'off',
};

export interface TopBarProps {
  flashMode: FlashMode;
  /** False when the active device has no flash (most front cameras). */
  flashAvailable: boolean;
  onCycleFlash: () => void;
  /** Tiny scene label from analysis, e.g. "PORTRAIT" / "NIGHT". */
  sceneLabel?: string;
  onOpenSettings: () => void;
}

/**
 * Safe-area top row of native-style camera chrome:
 *   left   → flash cycle (off / on / auto)
 *   centre → optional scene label
 *   right  → settings gear (opens the settings tray)
 */
function TopBarImpl({
  flashMode,
  flashAvailable,
  onCycleFlash,
  sceneLabel,
  onOpenSettings,
}: TopBarProps) {
  const insets = useSafeAreaInsets();
  const flashOn = flashAvailable && flashMode !== 'off';

  return (
    <View style={[styles.container, { paddingTop: insets.top + 6 }]} pointerEvents="box-none">
      {/* Flash */}
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`Flash ${flashAvailable ? flashMode : 'unavailable'}`}
        disabled={!flashAvailable}
        onPress={() => {
          Haptics.selectionAsync().catch(() => {});
          onCycleFlash();
        }}
        style={({ pressed }) => [
          styles.button,
          !flashAvailable && styles.buttonDisabled,
          pressed && styles.pressed,
        ]}
        hitSlop={8}
      >
        <Ionicons
          name={flashAvailable && flashMode !== 'off' ? 'flash' : 'flash-off'}
          size={20}
          color={flashOn ? '#FFD60A' : 'rgba(255,255,255,0.9)'}
        />
        {flashAvailable && flashMode === 'auto' && (
          <View style={styles.autoBadge}>
            <Text style={styles.autoBadgeText}>A</Text>
          </View>
        )}
      </Pressable>

      {/* Scene label */}
      <View style={styles.center} pointerEvents="none">
        {sceneLabel ? (
          <View style={styles.sceneChip}>
            <Text style={styles.sceneText}>{sceneLabel.toUpperCase()}</Text>
          </View>
        ) : null}
      </View>

      {/* Settings */}
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Settings"
        onPress={() => {
          Haptics.selectionAsync().catch(() => {});
          onOpenSettings();
        }}
        style={({ pressed }) => [styles.button, pressed && styles.pressed]}
        hitSlop={8}
      >
        <Ionicons name="settings-outline" size={21} color="rgba(255,255,255,0.9)" />
      </Pressable>
    </View>
  );
}

export const TopBar = React.memo(TopBarImpl);

const BUTTON = 40;

const styles = StyleSheet.create({
  container: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 14,
    paddingBottom: 6,
  },
  button: {
    width: BUTTON,
    height: BUTTON,
    borderRadius: BUTTON / 2,
    backgroundColor: 'rgba(0,0,0,0.45)',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(255,255,255,0.25)',
  },
  buttonDisabled: { opacity: 0.4 },
  pressed: { opacity: 0.6 },
  autoBadge: {
    position: 'absolute',
    top: 4,
    right: 4,
    minWidth: 13,
    height: 13,
    borderRadius: 4,
    backgroundColor: '#FFD60A',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 2,
  },
  autoBadgeText: { color: '#000', fontSize: 9, fontWeight: '900', includeFontPadding: false },
  center: { flex: 1, alignItems: 'center' },
  sceneChip: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 10,
    backgroundColor: 'rgba(0,0,0,0.45)',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(255,255,255,0.25)',
  },
  sceneText: {
    color: 'rgba(255,255,255,0.85)',
    fontSize: 10,
    fontWeight: '800',
    letterSpacing: 1.5,
    includeFontPadding: false,
  },
});
