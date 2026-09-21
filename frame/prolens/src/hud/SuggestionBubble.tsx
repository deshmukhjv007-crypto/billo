import React, { useEffect, useRef } from 'react';
import { Animated, StyleSheet, Text } from 'react-native';
import { Suggestion } from '../coaching/SuggestionEngine';

export function SuggestionBubble({ suggestion }: { suggestion: Suggestion }) {
  const opacity = useRef(new Animated.Value(0)).current;
  const translateY = useRef(new Animated.Value(-10)).current;

  useEffect(() => {
    Animated.parallel([
      Animated.timing(opacity, {
        toValue: 1,
        duration: 300,
        useNativeDriver: true,
      }),
      Animated.spring(translateY, {
        toValue: 0,
        useNativeDriver: true,
      }),
    ]).start();
  }, [opacity, translateY]);

  const bgColor = {
    critical: 'rgba(255,59,48,0.95)',
    high: 'rgba(255,149,0,0.95)',
    medium: 'rgba(0,122,255,0.9)',
    low: 'rgba(0,0,0,0.75)',
    praise: 'rgba(52,199,89,0.95)',
  }[suggestion.priority];

  return (
    <Animated.View
      style={[
        styles.bubble,
        { backgroundColor: bgColor, opacity, transform: [{ translateY }] },
      ]}
    >
      <Text style={styles.icon}>{suggestion.icon}</Text>
      <Text style={styles.message}>{suggestion.message}</Text>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  bubble: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderRadius: 24,
    gap: 10,
  },
  icon: { fontSize: 20 },
  message: { color: 'white', fontSize: 15, fontWeight: '600', flex: 1 },
});
