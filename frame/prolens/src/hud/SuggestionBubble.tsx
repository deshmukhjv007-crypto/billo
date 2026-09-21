import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import Animated, { FadeInDown, FadeOut, LinearTransition } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { Suggestion, SuggestionPriority, VisualCue } from '../coaching/SuggestionEngine';

/**
 * Coaching pills — less text, more icon.
 *
 * At most ONE primary pill sits at the top of the viewfinder in the form
 * `[glyph] short action` (↺ Tilt left · ← Pan left · 📸 Shoot now). A second,
 * smaller pill is shown only when it is high/critical AND from a different
 * category than the primary, so two unrelated problems can be flagged at once
 * without stacking a wall of text over faces.
 */

const GLYPH: Record<VisualCue, string> = {
  'arrow-left': '←',
  'arrow-right': '→',
  'arrow-up': '↑',
  'arrow-down': '↓',
  'rotate-cw': '↻',
  'rotate-ccw': '↺',
  'step-closer': '⊕',
  'step-back': '⊖',
  'tap-to-focus': '◎',
  wait: '✋',
  'shoot-now': '📸',
};

const BG: Record<SuggestionPriority, string> = {
  critical: 'rgba(255,59,48,0.92)',
  high: 'rgba(255,149,0,0.92)',
  medium: 'rgba(0,122,255,0.88)',
  low: 'rgba(0,0,0,0.7)',
  praise: 'rgba(52,199,89,0.92)',
};

/** Glyph shown before the label — direction first, emoji as a fallback. */
export function glyphFor(s: Suggestion): string {
  return s.visualCue ? GLYPH[s.visualCue] : s.icon;
}

/** Applies the "one primary + optional secondary" rule. */
export function pickVisible(suggestions: Suggestion[]): Suggestion[] {
  const primary = suggestions[0];
  if (!primary) return [];
  const secondary = suggestions
    .slice(1)
    .find(
      (s) =>
        (s.priority === 'critical' || s.priority === 'high') &&
        s.category !== primary.category
    );
  return secondary ? [primary, secondary] : [primary];
}

function SuggestionBubbleImpl({ suggestions }: { suggestions: Suggestion[] }) {
  const insets = useSafeAreaInsets();
  const visible = pickVisible(suggestions);
  if (visible.length === 0) return null;

  return (
    <View style={[styles.container, { top: insets.top + 60 }]} pointerEvents="none">
      {visible.map((s, i) => (
        <Animated.View
          key={s.id}
          entering={FadeInDown.duration(220)}
          exiting={FadeOut.duration(160)}
          layout={LinearTransition.duration(180)}
          style={[
            styles.pill,
            i === 1 && styles.pillSecondary,
            { backgroundColor: BG[s.priority] },
          ]}
        >
          <Text style={[styles.glyph, i === 1 && styles.glyphSecondary]}>{glyphFor(s)}</Text>
          <Text
            style={[styles.label, i === 1 && styles.labelSecondary]}
            numberOfLines={1}
          >
            {s.label}
          </Text>
        </Animated.View>
      ))}
    </View>
  );
}

export const SuggestionBubble = React.memo(SuggestionBubbleImpl);

const styles = StyleSheet.create({
  container: {
    position: 'absolute',
    left: 0,
    right: 0,
    alignItems: 'center',
    gap: 6,
  },
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingLeft: 12,
    paddingRight: 16,
    paddingVertical: 8,
    borderRadius: 22,
    gap: 8,
    maxWidth: '80%',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(255,255,255,0.35)',
    shadowColor: '#000',
    shadowOpacity: 0.35,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 2 },
    elevation: 4,
  },
  pillSecondary: {
    paddingVertical: 5,
    paddingLeft: 10,
    paddingRight: 12,
    opacity: 0.92,
  },
  glyph: {
    color: 'white',
    fontSize: 20,
    fontWeight: '800',
    lineHeight: 24,
    includeFontPadding: false,
  },
  glyphSecondary: { fontSize: 15, lineHeight: 18 },
  label: {
    color: 'white',
    fontSize: 16,
    fontWeight: '700',
    letterSpacing: 0.2,
    includeFontPadding: false,
  },
  labelSecondary: { fontSize: 13 },
});
