import React from 'react';
import { View, StyleSheet, Text } from 'react-native';

export function HUDOverlay({ readyScore }: { readyScore: number }) {
  const isReady = readyScore > 0.85;
  return (
    <>
      {isReady && (
        <View style={styles.corners} pointerEvents="none">
          <View style={[styles.corner, styles.tl]} />
          <View style={[styles.corner, styles.tr]} />
          <View style={[styles.corner, styles.bl]} />
          <View style={[styles.corner, styles.br]} />
        </View>
      )}
      <View style={styles.scoreContainer}>
        <Text style={styles.score}>{Math.round(readyScore * 100)}</Text>
      </View>
    </>
  );
}

const styles = StyleSheet.create({
  corners: { ...StyleSheet.absoluteFillObject },
  corner: {
    position: 'absolute',
    width: 30,
    height: 30,
    borderColor: '#00ff88',
    borderWidth: 3,
  },
  tl: { top: 80, left: 20, borderRightWidth: 0, borderBottomWidth: 0 },
  tr: { top: 80, right: 20, borderLeftWidth: 0, borderBottomWidth: 0 },
  bl: { bottom: 150, left: 20, borderRightWidth: 0, borderTopWidth: 0 },
  br: { bottom: 150, right: 20, borderLeftWidth: 0, borderTopWidth: 0 },
  scoreContainer: {
    position: 'absolute',
    top: 60,
    right: 20,
    backgroundColor: 'rgba(0,0,0,0.6)',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 12,
  },
  score: { color: 'white', fontSize: 16, fontWeight: '700' },
});
