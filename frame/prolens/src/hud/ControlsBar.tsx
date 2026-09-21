import React from 'react';
import { View, StyleSheet, TouchableOpacity, Text } from 'react-native';
import * as Haptics from 'expo-haptics';

interface ControlsBarProps {
  voiceEnabled: boolean;
  onToggleVoice: () => void;
  gridType: 'thirds' | 'golden' | 'off';
  onCycleGrid: () => void;
}

export function ControlsBar({
  voiceEnabled,
  onToggleVoice,
  gridType,
  onCycleGrid,
}: ControlsBarProps) {
  return (
    <View style={styles.container}>
      {/* Grid Mode Selector */}
      <TouchableOpacity
        style={styles.button}
        onPress={() => {
          Haptics.selectionAsync();
          onCycleGrid();
        }}
      >
        <Text style={styles.icon}>🌐</Text>
        <Text style={styles.label}>{gridType.toUpperCase()}</Text>
      </TouchableOpacity>

      {/* Voice Coach Toggle */}
      <TouchableOpacity
        style={[styles.button, voiceEnabled && styles.activeButton]}
        onPress={() => {
          Haptics.selectionAsync();
          onToggleVoice();
        }}
      >
        <Text style={styles.icon}>{voiceEnabled ? '🔊' : '🔇'}</Text>
        <Text style={[styles.label, voiceEnabled && styles.activeLabel]}>
          {voiceEnabled ? 'VOICE ON' : 'MUTED'}
        </Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    position: 'absolute',
    // Below the suggestion bubbles (top 60 + up to 2 bubbles ≈ 164px) so the
    // toggles never sit under coaching tips.
    top: 170,
    left: 20,
    flexDirection: 'row',
    gap: 10,
  },
  button: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(0,0,0,0.65)',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.2)',
    gap: 6,
  },
  activeButton: {
    borderColor: '#00FF88',
    backgroundColor: 'rgba(0,255,136,0.15)',
  },
  icon: { fontSize: 14 },
  label: { color: 'rgba(255,255,255,0.8)', fontSize: 11, fontWeight: '700' },
  activeLabel: { color: '#00FF88' },
});
