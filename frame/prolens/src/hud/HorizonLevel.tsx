import React from 'react';
import { View, StyleSheet, Dimensions } from 'react-native';

const { width } = Dimensions.get('window');

export function HorizonLevel({ tilt }: { tilt: number }) {
  const isLevel = Math.abs(tilt) < 1.5;
  return (
    <View style={styles.container} pointerEvents="none">
      <View
        style={[
          styles.line,
          {
            transform: [{ rotate: `${tilt}deg` }],
            backgroundColor: isLevel ? '#00ff88' : 'rgba(255,255,255,0.6)',
          },
        ]}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    position: 'absolute',
    top: '50%',
    left: 0,
    right: 0,
    alignItems: 'center',
  },
  line: { width: width * 0.3, height: 2, borderRadius: 1 },
});
