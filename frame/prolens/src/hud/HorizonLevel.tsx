import React, { useEffect, useRef } from 'react';
import { View, StyleSheet, Text } from 'react-native';
import Animated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';
import * as Haptics from 'expo-haptics';

/**
 * Spirit level — a horizontal bubble level in the centre of the viewfinder.
 *
 * The bubble is a pill that slides along X with the roll of the phone, like
 * the air bubble in a builder's level: it drifts towards the side that is
 * HIGH, so you lower that side until it sits between the centre gates.
 * Tick marks at −5° / 0 / +5°. No raw numbers on the live view — the exact
 * tilt lives in the Review screen.
 *
 * Colour bands (|tilt|):
 *   < 1°  → green (+ one light haptic when entering)
 *   < 3°  → yellow
 *   else  → white 50 %
 */

export const LEVEL_GREEN_DEG = 1.0;
export const LEVEL_YELLOW_DEG = 3.0;
/** Re-arm the "entered level" haptic only once we've clearly left the band. */
const HAPTIC_REARM_DEG = 1.6;

const TRACK_W = 240;
const TRACK_H = 12;
const BUBBLE_W = 38;
const BUBBLE_H = 16;
const PX_PER_DEG = 20; // ±5° ticks sit at ±100 px
const MAX_DEG = 5; // bubble pins at the outer ticks beyond this
const TICKS = [-5, 0, 5] as const;

const COLORS = {
  green: '#00FF88',
  yellow: '#FFD60A',
  neutral: 'rgba(255,255,255,0.5)',
} as const;

export type LevelBand = 'green' | 'yellow' | 'neutral';

export function levelBand(tilt: number): LevelBand {
  const t = Math.abs(tilt);
  if (t < LEVEL_GREEN_DEG) return 'green';
  if (t < LEVEL_YELLOW_DEG) return 'yellow';
  return 'neutral';
}

function HorizonLevelImpl({ tilt }: { tilt: number }) {
  const safeTilt = Number.isFinite(tilt) ? tilt : 0;
  const band = levelBand(safeTilt);
  const color = COLORS[band];

  // Bubble position — towards the high side (opposite to the roll sign),
  // clamped to the outer ticks.
  const clamped = Math.max(-MAX_DEG, Math.min(MAX_DEG, -safeTilt));
  const x = useSharedValue(clamped * PX_PER_DEG);
  useEffect(() => {
    x.value = withTiming(clamped * PX_PER_DEG, {
      duration: 90,
      easing: Easing.out(Easing.quad),
    });
  }, [clamped, x]);

  const bubbleStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: x.value }],
  }));

  // One light haptic when we settle into the green band; re-arm only after
  // clearly leaving it so a reading hovering at 1.0° can't buzz repeatedly.
  const armedRef = useRef(true);
  useEffect(() => {
    const t = Math.abs(safeTilt);
    if (t < LEVEL_GREEN_DEG && armedRef.current) {
      armedRef.current = false;
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
    } else if (t > HAPTIC_REARM_DEG) {
      armedRef.current = true;
    }
  }, [safeTilt]);

  return (
    <View style={styles.container} pointerEvents="none">
      <View style={styles.level}>
        {/* Tick marks */}
        {TICKS.map((deg) => (
          <View
            key={deg}
            style={[
              styles.tick,
              deg === 0 && styles.tickCenter,
              { left: TRACK_W / 2 + deg * PX_PER_DEG - 1 },
            ]}
          />
        ))}

        {/* Slot */}
        <View style={styles.track}>
          {/* Centre gates (target zone) */}
          <View style={[styles.gate, { left: TRACK_W / 2 - BUBBLE_W / 2 - 4 }]} />
          <View style={[styles.gate, { left: TRACK_W / 2 + BUBBLE_W / 2 + 2 }]} />

          {/* Bubble */}
          <Animated.View
            style={[
              styles.bubble,
              bubbleStyle,
              {
                backgroundColor: color,
                shadowColor: band === 'green' ? COLORS.green : 'transparent',
              },
            ]}
          />
        </View>

        {/* Tick labels */}
        <View style={styles.labels}>
          {TICKS.map((deg) => (
            <Text
              key={deg}
              style={[
                styles.label,
                { left: TRACK_W / 2 + deg * PX_PER_DEG - 14 },
                band === 'green' && deg === 0 && { color: COLORS.green },
              ]}
            >
              {deg === 0 ? '0' : `${deg > 0 ? '+' : '−'}${Math.abs(deg)}°`}
            </Text>
          ))}
        </View>
      </View>
    </View>
  );
}

export const HorizonLevel = React.memo(HorizonLevelImpl);

const styles = StyleSheet.create({
  container: {
    position: 'absolute',
    top: '50%',
    left: 0,
    right: 0,
    alignItems: 'center',
    marginTop: -22,
  },
  level: {
    width: TRACK_W,
    height: 44,
  },
  tick: {
    position: 'absolute',
    top: 2,
    width: 2,
    height: 8,
    borderRadius: 1,
    backgroundColor: 'rgba(255,255,255,0.55)',
  },
  tickCenter: {
    top: 0,
    height: 10,
    backgroundColor: 'rgba(255,255,255,0.9)',
  },
  track: {
    position: 'absolute',
    top: 13,
    left: 0,
    width: TRACK_W,
    height: TRACK_H,
    borderRadius: TRACK_H / 2,
    backgroundColor: 'rgba(0,0,0,0.35)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.35)',
    justifyContent: 'center',
  },
  gate: {
    position: 'absolute',
    top: -4,
    width: 2,
    height: TRACK_H + 6,
    borderRadius: 1,
    backgroundColor: 'rgba(255,255,255,0.85)',
  },
  bubble: {
    position: 'absolute',
    left: TRACK_W / 2 - BUBBLE_W / 2,
    top: (TRACK_H - 2 - BUBBLE_H) / 2,
    width: BUBBLE_W,
    height: BUBBLE_H,
    borderRadius: BUBBLE_H / 2,
    shadowOpacity: 0.9,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 0 },
    elevation: 2,
  },
  labels: {
    position: 'absolute',
    top: 29,
    left: 0,
    width: TRACK_W,
    height: 14,
  },
  label: {
    position: 'absolute',
    width: 28,
    textAlign: 'center',
    color: 'rgba(255,255,255,0.6)',
    fontSize: 9,
    fontWeight: '700',
    letterSpacing: 0.3,
    textShadowColor: 'rgba(0,0,0,0.8)',
    textShadowRadius: 3,
  },
});
