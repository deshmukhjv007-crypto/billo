import { FrameAnalysis } from '../ai/SceneAnalyzer';
import { COMPOSITION_RULES, EXPOSURE_RULES } from './PhotographyRules';

/**
 * Visual direction attached to a suggestion. The HUD turns these into big
 * chevrons / rotate arrows (DirectionOverlay) and a glyph on the pill.
 *
 * Convention: every cue is the direction to MOVE THE PHONE — the same way
 * "tilt phone left" is phrased. `arrow-left` = pan the phone left,
 * `rotate-ccw` = tilt the phone left (counter-clockwise), and so on.
 */
export type VisualCue =
  | 'arrow-left'
  | 'arrow-right'
  | 'arrow-up'
  | 'arrow-down'
  | 'rotate-cw'
  | 'rotate-ccw'
  | 'step-back'
  | 'step-closer'
  | 'tap-to-focus'
  | 'wait'
  | 'shoot-now';

export type SuggestionPriority = 'critical' | 'high' | 'medium' | 'low' | 'praise';

export type Suggestion = {
  id: string;
  priority: SuggestionPriority;
  category: 'composition' | 'lighting' | 'focus' | 'motion' | 'timing' | 'pro-tip';
  /**
   * Short action (≤ 3 words) shown on the HUD pill and spoken by VoiceCoach,
   * e.g. "Tilt left", "Pan right", "Hold steady", "Shoot now".
   */
  label: string;
  /** Longer explanation — used by the review screen / debugging, never read aloud. */
  message: string;
  icon: string;
  action?: SuggestionAction;
  visualCue?: VisualCue;
};

export type SuggestionAction = {
  type: 'move' | 'rotate' | 'tap' | 'adjust' | 'wait' | 'capture';
  magnitude?: number;
  target?: Point;
};

type Point = { x: number; y: number };

const PRIORITY_WEIGHT: Record<SuggestionPriority, number> = {
  critical: 100,
  high: 80,
  medium: 60,
  low: 40,
  praise: 30,
};

/** Priorities that are informational — shown briefly, then rested for a while. */
const TRANSIENT_PRIORITIES: ReadonlySet<SuggestionPriority> = new Set(['low', 'praise']);

export class SuggestionEngine {
  /** Ids currently surfaced on the HUD. */
  private active = new Set<string>();
  /** When each active id first surfaced (transient tips have a display budget). */
  private activeSince = new Map<string, number>();
  /** Earliest time an id may surface again after it cleared / was bumped. */
  private cooldownUntil = new Map<string, number>();
  /** Ids whose last surfaced priority was transient (picks the cooldown length). */
  private transientIds = new Set<string>();

  /** Action tips: brief rest after they clear so a borderline reading can't strobe. */
  private readonly RESURFACE_COOLDOWN_MS = 1500;
  /** Pro-tips / praise: how long they stay on screen… */
  private readonly TRANSIENT_SHOW_MS = 4000;
  /** …and how long before the same one is allowed to repeat. */
  private readonly TRANSIENT_COOLDOWN_MS = 20000;

  private readonly MAX_VISIBLE = 2;

  /**
   * Returns the suggestions that should be on screen right now, highest
   * priority first (max 2).
   *
   * Semantics: an action tip (critical/high/medium) stays surfaced for as
   * long as its condition holds and disappears the moment it clears — the
   * spirit level, chevrons and pills therefore track the live scene instead
   * of flashing once and going quiet. Transient tips (low/praise) get a
   * short display budget and a long cooldown so they never nag.
   */
  generate(analysis: FrameAnalysis): Suggestion[] {
    const all: Suggestion[] = [];

    // Run all rule checks
    all.push(...this.checkHorizon(analysis));
    all.push(...this.checkComposition(analysis));
    all.push(...this.checkLighting(analysis));
    all.push(...this.checkFaces(analysis));
    all.push(...this.checkMotion(analysis));
    all.push(...this.checkFocus(analysis));
    all.push(...this.checkSceneSpecific(analysis));
    all.push(...this.checkDecisiveMoment(analysis));
    all.push(...this.checkPraise(analysis));

    const now = Date.now();

    const eligible = all.filter((s) => {
      if (this.active.has(s.id)) {
        // Transient tips expire after their display budget.
        if (TRANSIENT_PRIORITIES.has(s.priority)) {
          const since = this.activeSince.get(s.id) ?? now;
          return now - since < this.TRANSIENT_SHOW_MS;
        }
        return true;
      }
      return now >= (this.cooldownUntil.get(s.id) ?? 0);
    });

    const sorted = eligible.sort(
      (a, b) => PRIORITY_WEIGHT[b.priority] - PRIORITY_WEIGHT[a.priority]
    );
    const top = sorted.slice(0, this.MAX_VISIBLE);

    // Book-keeping: ids that dropped out start their cooldown.
    const nextActive = new Set(top.map((s) => s.id));
    for (const s of top) {
      if (!this.active.has(s.id)) this.activeSince.set(s.id, now);
    }
    for (const id of this.active) {
      if (nextActive.has(id)) continue;
      const wasTransient = this.transientIds.has(id);
      this.cooldownUntil.set(
        id,
        now + (wasTransient ? this.TRANSIENT_COOLDOWN_MS : this.RESURFACE_COOLDOWN_MS)
      );
      this.activeSince.delete(id);
    }
    for (const s of top) {
      if (TRANSIENT_PRIORITIES.has(s.priority)) this.transientIds.add(s.id);
      else this.transientIds.delete(s.id);
    }
    this.active = nextActive;

    return top;
  }

  /** Forget all cooldowns/active state (e.g. after a capture or camera flip). */
  reset() {
    this.active.clear();
    this.activeSince.clear();
    this.cooldownUntil.clear();
    this.transientIds.clear();
  }

  // ═══════════════════════════════════════════════════════════
  // HORIZON — Non-negotiable rule
  // ═══════════════════════════════════════════════════════════
  private checkHorizon(a: FrameAnalysis): Suggestion[] {
    if (!a.horizon.detected) return [];
    const tilt = a.horizon.tilt;

    if (Math.abs(tilt) > COMPOSITION_RULES.HORIZON_LEVEL.maxTilt) {
      // tilt > 0 → phone is rolled clockwise → rotate it counter-clockwise ("tilt left").
      const tiltLeft = tilt > 0;
      return [
        {
          id: 'horizon-tilt',
          priority: Math.abs(tilt) > 5 ? 'critical' : 'high',
          category: 'composition',
          label: tiltLeft ? 'Tilt left' : 'Tilt right',
          message: `Level horizon (${tiltLeft ? 'tilt left' : 'tilt right'} ${Math.abs(tilt).toFixed(1)}°)`,
          icon: '📐',
          visualCue: tiltLeft ? 'rotate-ccw' : 'rotate-cw',
          action: { type: 'rotate', magnitude: -tilt },
        },
      ];
    }
    return [];
  }

  // ═══════════════════════════════════════════════════════════
  // COMPOSITION — Rule of thirds, headroom, looking room
  // ═══════════════════════════════════════════════════════════
  private checkComposition(a: FrameAnalysis): Suggestion[] {
    const tips: Suggestion[] = [];

    // Rule of thirds for main subject
    if (a.faces[0]) {
      const face = a.faces[0];
      const centerX = face.bounds.x + face.bounds.width / 2;
      const centerY = face.bounds.y + face.bounds.height / 2;
      void centerY; // Vertical thirds check lands with the golden-ratio overlay milestone

      const thirdsX = [0.333, 0.667];
      const nearestX = thirdsX.reduce((prev, curr) =>
        Math.abs(curr - centerX) < Math.abs(prev - centerX) ? curr : prev
      );
      const offsetX = centerX - nearestX;

      if (Math.abs(offsetX) > COMPOSITION_RULES.RULE_OF_THIRDS.tolerance) {
        // Subject sits right of the line → pan the phone right (the subject
        // drifts left in frame onto the line), and vice versa.
        const panRight = offsetX > 0;
        tips.push({
          id: 'rot-x',
          priority: 'medium',
          category: 'composition',
          label: panRight ? 'Pan right' : 'Pan left',
          message: panRight
            ? 'Pan right to align subject with grid line'
            : 'Pan left to align subject with grid line',
          icon: '🎯',
          visualCue: panRight ? 'arrow-right' : 'arrow-left',
          action: { type: 'move', magnitude: offsetX },
        });
      }

      // Headroom check (portrait)
      const headroom = face.bounds.y;
      if (headroom < COMPOSITION_RULES.HEADROOM.portraitMin) {
        tips.push({
          id: 'headroom-tight',
          priority: 'high',
          category: 'composition',
          label: 'Tilt up',
          message: 'Too tight above head — tilt up slightly',
          icon: '👤',
          visualCue: 'arrow-up',
        });
      } else if (headroom > COMPOSITION_RULES.HEADROOM.portraitMax * 2) {
        tips.push({
          id: 'headroom-loose',
          priority: 'medium',
          category: 'composition',
          label: 'Tilt down',
          message: 'Too much headroom — get closer or tilt down',
          icon: '👤',
          visualCue: 'arrow-down',
        });
      }

      // Looking room (subject should have space in direction they face)
      if (face.eyeDirection !== 'center') {
        const spaceInDirection =
          face.eyeDirection === 'right'
            ? 1 - (face.bounds.x + face.bounds.width)
            : face.bounds.x;

        if (spaceInDirection < 0.3) {
          // Subject looks right → they need room on the right → pan the phone
          // right so the subject shifts left and opens space ahead of them.
          const panRight = face.eyeDirection === 'right';
          tips.push({
            id: 'looking-room',
            priority: 'medium',
            category: 'composition',
            label: panRight ? 'Pan right' : 'Pan left',
            message: 'Leave more space where subject is looking',
            icon: '👀',
            visualCue: panRight ? 'arrow-right' : 'arrow-left',
          });
        }
      }

      // Fill the frame — too far / too close
      const faceArea = face.bounds.width * face.bounds.height;
      if (a.scene === 'portrait' && faceArea < 0.08) {
        tips.push({
          id: 'get-closer',
          priority: 'medium',
          category: 'composition',
          label: 'Step closer',
          message: 'Get closer — fill the frame with your subject',
          icon: '🔍',
          visualCue: 'step-closer',
          action: { type: 'move' },
        });
      } else if (faceArea > COMPOSITION_RULES.FILL_THE_FRAME.minSubjectArea + 0.15) {
        tips.push({
          id: 'too-close',
          priority: 'medium',
          category: 'composition',
          label: 'Step back',
          message: 'Too close — step back so the face isn’t cropped',
          icon: '↔️',
          visualCue: 'step-back',
          action: { type: 'move' },
        });
      }
    }

    return tips;
  }

  // ═══════════════════════════════════════════════════════════
  // LIGHTING — The soul of photography
  // ═══════════════════════════════════════════════════════════
  private checkLighting(a: FrameAnalysis): Suggestion[] {
    const tips: Suggestion[] = [];
    const L = a.lighting;

    // Backlit subject — critical for portraits
    if (L.isBacklit && a.faces[0]) {
      tips.push({
        id: 'backlit',
        priority: 'critical',
        category: 'lighting',
        label: 'Tap the face',
        message: 'Subject is backlit — tap face to expose properly',
        icon: '☀️',
        visualCue: 'tap-to-focus',
        action: {
          type: 'tap',
          target: {
            x: a.faces[0].bounds.x + a.faces[0].bounds.width / 2,
            y: a.faces[0].bounds.y + a.faces[0].bounds.height / 2,
          },
        },
      });
    }

    // Blown highlights
    if (L.clippedHighlights > EXPOSURE_RULES.PROTECT_HIGHLIGHTS.maxClipping) {
      tips.push({
        id: 'blown-highlights',
        priority: 'high',
        category: 'lighting',
        label: 'Too bright',
        message: `Highlights blown (${(L.clippedHighlights * 100).toFixed(0)}%) — reduce exposure`,
        icon: '⚠️',
      });
    }

    // Harsh shadows (midday sun)
    if (L.hasHarshShadows && a.scene === 'portrait') {
      tips.push({
        id: 'harsh-shadows',
        priority: 'high',
        category: 'lighting',
        label: 'Find shade',
        message: 'Harsh shadows on face — move to shade or open shade',
        icon: '🌥️',
      });
    }

    // Golden hour celebration
    if (L.isGoldenHour) {
      tips.push({
        id: 'golden-hour',
        priority: 'praise',
        category: 'lighting',
        label: 'Golden hour',
        message: '✨ Golden hour magic — shoot everything now!',
        icon: '🌅',
      });
    }

    // Blue hour
    if (L.isBlueHour && (a.scene === 'cityscape' || a.scene === 'landscape')) {
      tips.push({
        id: 'blue-hour',
        priority: 'praise',
        category: 'lighting',
        label: 'Blue hour',
        message: '💙 Blue hour — cinematic mood perfect for this scene',
        icon: '🌆',
      });
    }

    // Low light warning
    if (L.averageLuminance < 0.15) {
      tips.push({
        id: 'low-light',
        priority: 'medium',
        category: 'lighting',
        label: 'Brace the phone',
        message: 'Low light — brace against something stable',
        icon: '🌙',
        visualCue: 'wait',
      });
    }

    return tips;
  }

  // ═══════════════════════════════════════════════════════════
  // FACES — Portrait excellence
  // ═══════════════════════════════════════════════════════════
  private checkFaces(a: FrameAnalysis): Suggestion[] {
    if (a.faces.length === 0) return [];
    const tips: Suggestion[] = [];

    // Multiple faces — group portrait rules
    if (a.faces.length > 1) {
      const luminances = a.faces.map((f) => f.luminance);
      const spread = Math.max(...luminances) - Math.min(...luminances);
      if (spread > 0.3) {
        tips.push({
          id: 'uneven-face-light',
          priority: 'high',
          category: 'lighting',
          label: 'Even the light',
          message: 'Uneven lighting on faces — reposition group',
          icon: '👥',
        });
      }
    }

    // Sharpness of primary face
    if (a.faces[0].sharpness < 0.4) {
      tips.push({
        id: 'face-blurry',
        priority: 'high',
        category: 'focus',
        label: 'Tap the eyes',
        message: 'Face is soft — tap to focus on the eyes',
        icon: '👁️',
        visualCue: 'tap-to-focus',
      });
    }

    return tips;
  }

  // ═══════════════════════════════════════════════════════════
  // MOTION — Handheld stability
  // ═══════════════════════════════════════════════════════════
  private checkMotion(a: FrameAnalysis): Suggestion[] {
    if (a.motion > 0.25) {
      return [
        {
          id: 'shaky',
          priority: 'high',
          category: 'motion',
          label: 'Hold steady',
          message: 'Too shaky — brace elbows against your body',
          icon: '🤳',
          visualCue: 'wait',
          action: { type: 'wait' },
        },
      ];
    }
    if (a.motion > 0.15 && a.lighting.averageLuminance < 0.3) {
      return [
        {
          id: 'shaky-low-light',
          priority: 'critical',
          category: 'motion',
          label: 'Hold steady',
          message: 'Low light + movement = blur. Hold steady!',
          icon: '⚠️',
          visualCue: 'wait',
          action: { type: 'wait' },
        },
      ];
    }
    return [];
  }

  // ═══════════════════════════════════════════════════════════
  // FOCUS
  // ═══════════════════════════════════════════════════════════
  private checkFocus(_a: FrameAnalysis): Suggestion[] {
    void _a;
    // Focus tips handled by tap-to-focus in face checks
    return [];
  }

  // ═══════════════════════════════════════════════════════════
  // SCENE-SPECIFIC PRO TIPS
  // ═══════════════════════════════════════════════════════════
  private checkSceneSpecific(a: FrameAnalysis): Suggestion[] {
    const tips: Suggestion[] = [];

    switch (a.scene) {
      case 'food':
        tips.push({
          id: 'food-angle',
          priority: 'low',
          category: 'pro-tip',
          label: 'Try 45°',
          message: 'Try 45° angle or straight-down flat lay',
          icon: '🍽️',
        });
        break;

      case 'landscape':
        if (a.depthLayers < 2) {
          tips.push({
            id: 'landscape-foreground',
            priority: 'medium',
            category: 'pro-tip',
            label: 'Add foreground',
            message: 'Add foreground interest for depth',
            icon: '🏔️',
          });
        }
        break;

      case 'architecture':
        if (Math.abs(a.horizon.tilt) < 1) {
          tips.push({
            id: 'arch-symmetry',
            priority: 'low',
            category: 'pro-tip',
            label: 'Center it',
            message: 'Center for symmetry or use leading lines',
            icon: '🏛️',
          });
        }
        break;

      case 'street':
        tips.push({
          id: 'street-moment',
          priority: 'low',
          category: 'pro-tip',
          label: 'Wait for a subject',
          message: 'Wait for a subject to enter the frame',
          icon: '🚶',
          visualCue: 'wait',
        });
        break;

      case 'macro':
        tips.push({
          id: 'macro-focus',
          priority: 'medium',
          category: 'pro-tip',
          label: 'Tap to focus',
          message: 'Focus stack: tap different points for depth',
          icon: '🌸',
          visualCue: 'tap-to-focus',
        });
        break;

      case 'night':
        tips.push({
          id: 'night-tripod',
          priority: 'medium',
          category: 'pro-tip',
          label: 'Rest the phone',
          message: 'Rest phone on stable surface for long exposure',
          icon: '🌃',
          visualCue: 'wait',
        });
        break;
    }

    return tips;
  }

  // ═══════════════════════════════════════════════════════════
  // DECISIVE MOMENT (Cartier-Bresson)
  // ═══════════════════════════════════════════════════════════
  private checkDecisiveMoment(a: FrameAnalysis): Suggestion[] {
    // When composition score is high AND subject is looking at camera
    if (
      a.composition.overallScore > 0.85 &&
      a.faces[0]?.isLookingAtCamera &&
      a.motion < 0.1
    ) {
      return [
        {
          id: 'shoot-now',
          priority: 'critical',
          category: 'timing',
          label: 'Shoot now',
          message: '📸 SHOOT NOW — everything is aligned!',
          icon: '⚡',
          visualCue: 'shoot-now',
          action: { type: 'capture' },
        },
      ];
    }
    return [];
  }

  // ═══════════════════════════════════════════════════════════
  // PRAISE — Positive reinforcement
  // ═══════════════════════════════════════════════════════════
  private checkPraise(a: FrameAnalysis): Suggestion[] {
    if (a.composition.overallScore > 0.9) {
      return [
        {
          id: 'praise-comp',
          priority: 'praise',
          category: 'composition',
          label: 'Nice frame',
          message: '🎨 Beautiful composition!',
          icon: '⭐',
        },
      ];
    }
    return [];
  }
}
