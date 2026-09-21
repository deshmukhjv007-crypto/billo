import React from 'react';
import { View, StyleSheet, Dimensions } from 'react-native';

const { width, height } = Dimensions.get('window');

export function GridOverlay({ type = 'thirds' }: { type?: 'thirds' | 'golden' }) {
  const ratios = type === 'thirds' ? [0.333, 0.667] : [0.382, 0.618];

  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="none">
      {ratios.map((r) => (
        <View key={`v-${r}`} style={[styles.vLine, { left: width * r }]} />
      ))}
      {ratios.map((r) => (
        <View key={`h-${r}`} style={[styles.hLine, { top: height * r }]} />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  vLine: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    width: 0.5,
    backgroundColor: 'rgba(255,255,255,0.3)',
  },
  hLine: {
    position: 'absolute',
    left: 0,
    right: 0,
    height: 0.5,
    backgroundColor: 'rgba(255,255,255,0.3)',
  },
});
