import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';

export type GridType = 'thirds' | 'golden' | 'off';

export const GRID_OPTIONS: { value: GridType; label: string }[] = [
  { value: 'thirds', label: 'THIRDS' },
  { value: 'golden', label: 'GOLDEN' },
  { value: 'off', label: 'OFF' },
];

export interface ControlsBarProps {
  voiceEnabled: boolean;
  onToggleVoice: () => void;
  gridType: GridType;
  onSelectGrid: (type: GridType) => void;
}

/**
 * Compact settings tray content (lives under the ⚙ gear so it never competes
 * with the viewfinder):
 *
 *   GRID   [THIRDS | GOLDEN | OFF]
 *   VOICE  [VOICE OFF]            ← default off
 */
function ControlsBarImpl({
  voiceEnabled,
  onToggleVoice,
  gridType,
  onSelectGrid,
}: ControlsBarProps) {
  return (
    <View style={styles.container}>
      {/* Grid */}
      <View style={styles.rowBlock}>
        <View style={styles.rowHeader}>
          <Ionicons name="grid-outline" size={16} color="rgba(255,255,255,0.7)" />
          <Text style={styles.rowTitle}>GRID</Text>
        </View>
        <View style={styles.segmented}>
          {GRID_OPTIONS.map((opt) => {
            const selected = opt.value === gridType;
            return (
              <Pressable
                key={opt.value}
                accessibilityRole="button"
                accessibilityState={{ selected }}
                onPress={() => {
                  if (selected) return;
                  Haptics.selectionAsync().catch(() => {});
                  onSelectGrid(opt.value);
                }}
                style={[styles.segment, selected && styles.segmentSelected]}
              >
                <Text style={[styles.segmentText, selected && styles.segmentTextSelected]}>
                  {opt.label}
                </Text>
              </Pressable>
            );
          })}
        </View>
      </View>

      {/* Voice */}
      <View style={styles.rowBlock}>
        <View style={styles.rowHeader}>
          <Ionicons
            name={voiceEnabled ? 'volume-high-outline' : 'volume-mute-outline'}
            size={16}
            color="rgba(255,255,255,0.7)"
          />
          <Text style={styles.rowTitle}>VOICE COACH</Text>
        </View>
        <Pressable
          accessibilityRole="switch"
          accessibilityState={{ checked: voiceEnabled }}
          onPress={() => {
            Haptics.selectionAsync().catch(() => {});
            onToggleVoice();
          }}
          style={[styles.toggle, voiceEnabled && styles.toggleOn]}
        >
          <Text style={[styles.toggleText, voiceEnabled && styles.toggleTextOn]}>
            {voiceEnabled ? 'VOICE ON' : 'VOICE OFF'}
          </Text>
        </Pressable>
      </View>
      <Text style={styles.hint}>
        Visual cues are always on. Voice speaks short commands like “Tilt left” only when
        enabled.
      </Text>
    </View>
  );
}

export const ControlsBar = React.memo(ControlsBarImpl);

const styles = StyleSheet.create({
  container: { gap: 16 },
  rowBlock: { gap: 8 },
  rowHeader: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  rowTitle: {
    color: 'rgba(255,255,255,0.7)',
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 1.2,
  },
  segmented: {
    flexDirection: 'row',
    backgroundColor: 'rgba(255,255,255,0.08)',
    borderRadius: 12,
    padding: 3,
    gap: 3,
  },
  segment: {
    flex: 1,
    paddingVertical: 9,
    borderRadius: 9,
    alignItems: 'center',
  },
  segmentSelected: { backgroundColor: 'rgba(255,255,255,0.18)' },
  segmentText: { color: 'rgba(255,255,255,0.6)', fontSize: 12, fontWeight: '700' },
  segmentTextSelected: { color: 'white' },
  toggle: {
    alignSelf: 'flex-start',
    paddingHorizontal: 16,
    paddingVertical: 9,
    borderRadius: 18,
    backgroundColor: 'rgba(255,255,255,0.08)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.18)',
  },
  toggleOn: { backgroundColor: 'rgba(0,255,136,0.15)', borderColor: '#00FF88' },
  toggleText: { color: 'rgba(255,255,255,0.8)', fontSize: 12, fontWeight: '800', letterSpacing: 0.8 },
  toggleTextOn: { color: '#00FF88' },
  hint: { color: 'rgba(255,255,255,0.45)', fontSize: 12, lineHeight: 17 },
});
