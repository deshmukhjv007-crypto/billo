import React, { useEffect, useState } from 'react';
import { StyleSheet, View, useWindowDimensions, ViewStyle } from 'react-native';
import Animated, {
  Easing,
  FadeIn,
  FadeOut,
  cancelAnimation,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withTiming,
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { SuggestionPriority, VisualCue } from '../coaching/SuggestionEngine';

/**
 * Full-screen, non-interactive layer that turns the top suggestion's
 * `visualCue` into a large, semi-transparent direction glyph:
 *
 *   arrow-left/right/up/down → big double chevron at that edge (nudges)
 *   rotate-cw / rotate-ccw   → curved rotate arrow above the spirit level
 *   step-closer / step-back  → magnifier with + / −
 *   shoot-now                → four corner brackets, green, pulsing
 *   wait                     → gentle breathing ring around the centre
 *   tap-to-focus             → reticle at the suggested tap point
 *
 * Shows for 2.5 s after a cue appears/changes, then gets out of the way
 * (the pill and spirit level stay). Clears immediately when the cue clears.
 * Critical cues and shoot-now pulse.
 *
 * Glyphs are plain Views with a dark outline layer, so they stay legible over
 * bright scenes on both platforms without an icon font.
 */

const SHOW_MS = 2500;
const WHITE = 'rgba(255,255,255,0.9)';
const OUTLINE = 'rgba(0,0,0,0.45)';
const GREEN = '#00FF88';
const OUTLINE_W = 3;

export interface DirectionOverlayProps {
  cue?: VisualCue;
  priority?: SuggestionPriority;
  /** Normalised (0–1) point for `tap-to-focus`; defaults to the centre. */
  target?: { x: number; y: number };
}

function DirectionOverlayImpl({ cue, priority, target }: DirectionOverlayProps) {
  const critical = priority === 'critical';
  const [shown, setShown] = useState<VisualCue | undefined>(undefined);

  useEffect(() => {
    if (!cue) {
      setShown(undefined);
      return;
    }
    setShown(cue);
    const t = setTimeout(() => setShown(undefined), SHOW_MS);
    return () => clearTimeout(t);
    // Re-show when the cue changes or escalates to critical.
  }, [cue, critical]);

  // The wrapper stays mounted so the glyph's exiting animation can play.
  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="none">
      {shown && (
        <CueGlyph
          key={shown}
          cue={shown}
          pulse={critical || shown === 'shoot-now'}
          target={target}
        />
      )}
    </View>
  );
}

export const DirectionOverlay = React.memo(DirectionOverlayImpl);

// ─────────────────────────────────────────────────────────────
// Glyph renderer (mounted per cue so animations start fresh)
// ─────────────────────────────────────────────────────────────

function CueGlyph({
  cue,
  pulse,
  target,
}: {
  cue: VisualCue;
  pulse: boolean;
  target?: { x: number; y: number };
}) {
  const { width, height } = useWindowDimensions();
  const insets = useSafeAreaInsets();

  // 0→1→0 breathing value; static when not pulsing.
  const p = useSharedValue(0);
  useEffect(() => {
    if (pulse) {
      p.value = withRepeat(
        withTiming(1, { duration: 550, easing: Easing.inOut(Easing.quad) }),
        -1,
        true
      );
    } else {
      p.value = 0;
    }
    return () => cancelAnimation(p);
  }, [p, pulse]);

  // Chevrons always nudge in their direction, so the motion itself reads as
  // "move this way" even before the pill is read.
  const n = useSharedValue(0);
  const isArrow = cue.startsWith('arrow-');
  useEffect(() => {
    if (isArrow) {
      n.value = withRepeat(
        withTiming(1, { duration: 700, easing: Easing.inOut(Easing.sin) }),
        -1,
        true
      );
    }
    return () => cancelAnimation(n);
  }, [n, isArrow]);

  const dir = arrowVector(cue);
  const animated = useAnimatedStyle(() => ({
    opacity: pulse ? 0.55 + 0.45 * p.value : 1,
    transform: [
      { translateX: dir.x * 12 * n.value },
      { translateY: dir.y * 12 * n.value },
      { scale: 1 + 0.06 * p.value },
    ],
  }));

  // Vertical band free of chrome: below the top bar + pill, above the bottom bar.
  const topBand = insets.top + 128;
  const bottomBand = insets.bottom + 210;
  const centerY = height / 2;
  // Glyphs that sit above the spirit level (which is centred, 44 px tall).
  const aboveLevel = (size: number) => centerY - 22 - 28 - size;

  const enter = FadeIn.duration(180);
  const exit = FadeOut.duration(220);

  switch (cue) {
    case 'arrow-left':
      return (
        <Animated.View
          entering={enter}
          exiting={exit}
          style={[styles.abs, { left: 14, top: centerY - CHEV_BOX / 2 }, animated]}
        >
          <DoubleChevron direction="left" />
        </Animated.View>
      );
    case 'arrow-right':
      return (
        <Animated.View
          entering={enter}
          exiting={exit}
          style={[styles.abs, { right: 14, top: centerY - CHEV_BOX / 2 }, animated]}
        >
          <DoubleChevron direction="right" />
        </Animated.View>
      );
    case 'arrow-up':
      return (
        <Animated.View
          entering={enter}
          exiting={exit}
          style={[styles.abs, { top: topBand, left: width / 2 - CHEV_BOX / 2 }, animated]}
        >
          <DoubleChevron direction="up" />
        </Animated.View>
      );
    case 'arrow-down':
      return (
        <Animated.View
          entering={enter}
          exiting={exit}
          style={[
            styles.abs,
            { bottom: bottomBand, left: width / 2 - CHEV_BOX / 2 },
            animated,
          ]}
        >
          <DoubleChevron direction="down" />
        </Animated.View>
      );
    case 'rotate-cw':
    case 'rotate-ccw':
      return (
        <Animated.View
          entering={enter}
          exiting={exit}
          style={[
            styles.abs,
            { top: aboveLevel(ROTATE_SIZE), left: width / 2 - ROTATE_SIZE / 2 },
            animated,
          ]}
        >
          <RotateArrow clockwise={cue === 'rotate-cw'} />
        </Animated.View>
      );
    case 'step-closer':
    case 'step-back':
      return (
        <Animated.View
          entering={enter}
          exiting={exit}
          style={[
            styles.abs,
            { top: aboveLevel(MAG_SIZE), left: width / 2 - MAG_SIZE / 2 },
            animated,
          ]}
        >
          <Magnifier plus={cue === 'step-closer'} />
        </Animated.View>
      );
    case 'shoot-now':
      return (
        <Animated.View
          entering={enter}
          exiting={exit}
          style={[
            StyleSheet.absoluteFill,
            { top: topBand - 24, bottom: bottomBand - 30 },
            animated,
          ]}
        >
          <CornerBrackets color={GREEN} />
        </Animated.View>
      );
    case 'wait':
      return (
        <Animated.View
          entering={enter}
          exiting={exit}
          style={[
            styles.abs,
            { top: centerY - WAIT_SIZE / 2, left: width / 2 - WAIT_SIZE / 2 },
            animated,
          ]}
        >
          <BreathingRing />
        </Animated.View>
      );
    case 'tap-to-focus': {
      const tx = (target?.x ?? 0.5) * width;
      const ty = (target?.y ?? 0.5) * height;
      return (
        <Animated.View
          entering={enter}
          exiting={exit}
          style={[
            styles.abs,
            {
              top: ty - RETICLE_SIZE / 2,
              left: tx - RETICLE_SIZE / 2,
              width: RETICLE_SIZE,
              height: RETICLE_SIZE,
            },
            animated,
          ]}
        >
          <CornerBrackets color={WHITE} size={24} thickness={3} inset={0} />
        </Animated.View>
      );
    }
    default:
      return null;
  }
}

function arrowVector(cue: VisualCue): { x: number; y: number } {
  switch (cue) {
    case 'arrow-left':
      return { x: -1, y: 0 };
    case 'arrow-right':
      return { x: 1, y: 0 };
    case 'arrow-up':
      return { x: 0, y: -1 };
    case 'arrow-down':
      return { x: 0, y: 1 };
    default:
      return { x: 0, y: 0 };
  }
}

// ─────────────────────────────────────────────────────────────
// Primitive glyphs (pure Views — no icon font dependency)
// ─────────────────────────────────────────────────────────────

const CHEV = 50;
const CHEV_STROKE = 9;
const CHEV_BOX = 84;
/** Distance between the two chevron tips. */
const CHEV_SPACING = 32;

/** Two nested chevrons (»), the trailing one fainter, pointing `direction`. */
function DoubleChevron({ direction }: { direction: 'left' | 'right' | 'up' | 'down' }) {
  // Base shape (borderTop + borderRight on a square) points up-right at 0°.
  const rotate = { up: '-45deg', right: '45deg', down: '135deg', left: '225deg' }[direction];
  const horizontal = direction === 'left' || direction === 'right';
  // The lead chevron is the one furthest along the direction of travel.
  const leadFirst = direction === 'left' || direction === 'up';
  const overlap = -(CHEV_BOX - CHEV_SPACING);
  const secondStyle: ViewStyle = horizontal
    ? { marginLeft: overlap }
    : { marginTop: overlap };

  const chevron = (opacity: number, extra?: ViewStyle) => (
    <View style={[styles.chevBox, extra]}>
      <View style={[styles.chevronOutline, { opacity, transform: [{ rotate }] }]} />
      <View style={[styles.chevron, { opacity, transform: [{ rotate }] }]} />
    </View>
  );

  return (
    <View style={horizontal ? styles.row : styles.column}>
      {leadFirst ? (
        <>
          {chevron(1)}
          {chevron(0.45, secondStyle)}
        </>
      ) : (
        <>
          {chevron(0.45)}
          {chevron(1, secondStyle)}
        </>
      )}
    </View>
  );
}

const ROTATE_SIZE = 112;
const ROTATE_STROKE = 9;

/** ¾ ring with an arrowhead at the open end — ↻ (clockwise) or ↺ (mirrored). */
function RotateArrow({ clockwise }: { clockwise: boolean }) {
  const r = ROTATE_SIZE / 2 - ROTATE_STROKE / 2;
  const end = r * Math.SQRT1_2; // arc ends 45° below the horizontal
  const cx = ROTATE_SIZE / 2 + end;
  const cy = ROTATE_SIZE / 2 + end;
  return (
    <View style={[styles.rotateBox, { transform: [{ scaleX: clockwise ? 1 : -1 }] }]}>
      <View style={styles.rotateRingOutline} />
      <View style={styles.rotateRing} />
      <View
        style={[
          styles.arrowHeadOutline,
          { left: cx - 17, top: cy - 12, transform: [{ rotate: '225deg' }] },
        ]}
      />
      <View
        style={[
          styles.arrowHead,
          { left: cx - 13, top: cy - 9, transform: [{ rotate: '225deg' }] },
        ]}
      />
    </View>
  );
}

const MAG_SIZE = 96;

/** Magnifier with + (closer) or − (back). */
function Magnifier({ plus }: { plus: boolean }) {
  return (
    <View style={styles.magBox}>
      <View style={styles.magHandleOutline} />
      <View style={styles.magHandle} />
      <View style={styles.magRingOutline} />
      <View style={styles.magRing}>
        <View style={styles.magBarH} />
        {plus && <View style={styles.magBarV} />}
      </View>
    </View>
  );
}

const WAIT_SIZE = 300;

function BreathingRing() {
  const s = useSharedValue(0);
  useEffect(() => {
    s.value = withRepeat(
      withTiming(1, { duration: 1400, easing: Easing.inOut(Easing.sin) }),
      -1,
      true
    );
    return () => cancelAnimation(s);
  }, [s]);
  const style = useAnimatedStyle(() => ({
    opacity: 0.25 + 0.5 * s.value,
    transform: [{ scale: 0.92 + 0.1 * s.value }],
  }));
  return (
    <Animated.View style={[styles.waitRing, style]}>
      <View style={styles.waitRingInner} />
    </Animated.View>
  );
}

const RETICLE_SIZE = 96;

/** Four corner brackets filling the parent. */
function CornerBrackets({
  color,
  size = 34,
  thickness = 4,
  inset = 20,
}: {
  color: string;
  size?: number;
  thickness?: number;
  inset?: number;
}) {
  const base: ViewStyle = {
    position: 'absolute',
    width: size,
    height: size,
    borderColor: color,
    borderWidth: thickness,
  };
  const tl: ViewStyle = { top: inset, left: inset, borderRightWidth: 0, borderBottomWidth: 0 };
  const tr: ViewStyle = { top: inset, right: inset, borderLeftWidth: 0, borderBottomWidth: 0 };
  const bl: ViewStyle = { bottom: inset, left: inset, borderRightWidth: 0, borderTopWidth: 0 };
  const br: ViewStyle = { bottom: inset, right: inset, borderLeftWidth: 0, borderTopWidth: 0 };
  return (
    <View style={StyleSheet.absoluteFill}>
      <View style={[base, styles.shadow, tl]} />
      <View style={[base, styles.shadow, tr]} />
      <View style={[base, styles.shadow, bl]} />
      <View style={[base, styles.shadow, br]} />
    </View>
  );
}

const styles = StyleSheet.create({
  abs: { position: 'absolute' },
  row: { flexDirection: 'row', alignItems: 'center' },
  column: { flexDirection: 'column', alignItems: 'center' },
  shadow: {
    shadowColor: '#000',
    shadowOpacity: 0.6,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 1 },
  },

  // Chevron
  chevBox: {
    width: CHEV_BOX,
    height: CHEV_BOX,
    alignItems: 'center',
    justifyContent: 'center',
  },
  chevron: {
    position: 'absolute',
    width: CHEV,
    height: CHEV,
    borderTopWidth: CHEV_STROKE,
    borderRightWidth: CHEV_STROKE,
    borderColor: WHITE,
    borderTopLeftRadius: 3,
    borderTopRightRadius: 5,
    borderBottomRightRadius: 3,
  },
  chevronOutline: {
    position: 'absolute',
    width: CHEV + OUTLINE_W * 2,
    height: CHEV + OUTLINE_W * 2,
    borderTopWidth: CHEV_STROKE + OUTLINE_W * 3,
    borderRightWidth: CHEV_STROKE + OUTLINE_W * 3,
    borderColor: OUTLINE,
    borderTopLeftRadius: 5,
    borderTopRightRadius: 8,
    borderBottomRightRadius: 5,
  },

  // Rotate arrow
  rotateBox: { width: ROTATE_SIZE, height: ROTATE_SIZE },
  rotateRing: {
    position: 'absolute',
    width: ROTATE_SIZE,
    height: ROTATE_SIZE,
    borderRadius: ROTATE_SIZE / 2,
    borderWidth: ROTATE_STROKE,
    borderColor: WHITE,
    borderBottomColor: 'transparent',
  },
  rotateRingOutline: {
    position: 'absolute',
    top: -OUTLINE_W,
    left: -OUTLINE_W,
    width: ROTATE_SIZE + OUTLINE_W * 2,
    height: ROTATE_SIZE + OUTLINE_W * 2,
    borderRadius: (ROTATE_SIZE + OUTLINE_W * 2) / 2,
    borderWidth: ROTATE_STROKE + OUTLINE_W * 2,
    borderColor: OUTLINE,
    borderBottomColor: 'transparent',
  },
  arrowHead: {
    position: 'absolute',
    width: 0,
    height: 0,
    borderLeftWidth: 13,
    borderRightWidth: 13,
    borderBottomWidth: 20,
    borderLeftColor: 'transparent',
    borderRightColor: 'transparent',
    borderBottomColor: WHITE,
  },
  arrowHeadOutline: {
    position: 'absolute',
    width: 0,
    height: 0,
    borderLeftWidth: 17,
    borderRightWidth: 17,
    borderBottomWidth: 26,
    borderLeftColor: 'transparent',
    borderRightColor: 'transparent',
    borderBottomColor: OUTLINE,
  },

  // Magnifier
  magBox: { width: MAG_SIZE, height: MAG_SIZE },
  magRing: {
    position: 'absolute',
    top: 0,
    left: 0,
    width: 70,
    height: 70,
    borderRadius: 35,
    borderWidth: 8,
    borderColor: WHITE,
    alignItems: 'center',
    justifyContent: 'center',
  },
  magRingOutline: {
    position: 'absolute',
    top: -OUTLINE_W,
    left: -OUTLINE_W,
    width: 70 + OUTLINE_W * 2,
    height: 70 + OUTLINE_W * 2,
    borderRadius: 35 + OUTLINE_W,
    borderWidth: 8 + OUTLINE_W * 2,
    borderColor: OUTLINE,
  },
  magBarH: {
    position: 'absolute',
    width: 30,
    height: 7,
    borderRadius: 3,
    backgroundColor: WHITE,
  },
  magBarV: {
    position: 'absolute',
    width: 7,
    height: 30,
    borderRadius: 3,
    backgroundColor: WHITE,
  },
  // Handle centred at (71, 71) so its 45° axis runs through the ring centre
  // (35, 35) and starts just inside the ring's outer edge.
  magHandle: {
    position: 'absolute',
    right: 6,
    bottom: 20,
    width: 38,
    height: 10,
    borderRadius: 5,
    backgroundColor: WHITE,
    transform: [{ rotate: '45deg' }],
  },
  magHandleOutline: {
    position: 'absolute',
    right: 6 - OUTLINE_W,
    bottom: 20 - OUTLINE_W,
    width: 38 + OUTLINE_W * 2,
    height: 10 + OUTLINE_W * 2,
    borderRadius: 5 + OUTLINE_W,
    backgroundColor: OUTLINE,
    transform: [{ rotate: '45deg' }],
  },

  // Wait
  waitRing: {
    width: WAIT_SIZE,
    height: WAIT_SIZE,
    borderRadius: WAIT_SIZE / 2,
    borderWidth: 3,
    borderColor: OUTLINE,
    alignItems: 'center',
    justifyContent: 'center',
  },
  waitRingInner: {
    width: WAIT_SIZE - 4,
    height: WAIT_SIZE - 4,
    borderRadius: (WAIT_SIZE - 4) / 2,
    borderWidth: 3,
    borderColor: WHITE,
  },
});
