import { FrameAnalysis } from '../ai/SceneAnalyzer';
import { COMPOSITION_RULES, EXPOSURE_RULES } from './PhotographyRules';

export type Suggestion = {
  id: string;
  priority: 'critical' | 'high' | 'medium' | 'low' | 'praise';
  category: 'composition' | 'lighting' | 'focus' | 'motion' | 'timing' | 'pro-tip';
  message: string;
  icon: string;
  action?: SuggestionAction;
  visualCue?:
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
};

export type SuggestionAction = {
  type: 'move' | 'rotate' | 'tap' | 'adjust' | 'wait' | 'capture';
  magnitude?: number;
  target?: Point;
};

type Point = { x: number; y: number };

export class SuggestionEngine {
  private lastSuggestions: Map<string, number> = new Map();
  private readonly COOLDOWN_MS = 3000; // Don't repeat same tip within 3s

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

    // Filter by cooldown
    const now = Date.now();
    const fresh = all.filter((s) => {
      const last = this.lastSuggestions.get(s.id) ?? 0;
      return now - last > this.COOLDOWN_MS;
    });

    // Sort by priority + take top 2
    const sorted = fresh.sort(
      (a, b) => this.priorityWeight(b.priority) - this.priorityWeight(a.priority)
    );

    const top = sorted.slice(0, 2);
    top.forEach((s) => this.lastSuggestions.set(s.id, now));
    return top;
  }

  // ═══════════════════════════════════════════════════════════
  // HORIZON — Non-negotiable rule
  // ═══════════════════════════════════════════════════════════
  private checkHorizon(a: FrameAnalysis): Suggestion[] {
    if (!a.horizon.detected) return [];
    const tilt = a.horizon.tilt;

    if (Math.abs(tilt) > COMPOSITION_RULES.HORIZON_LEVEL.maxTilt) {
      return [
        {
          id: 'horizon-tilt',
          priority: Math.abs(tilt) > 5 ? 'critical' : 'high',
          category: 'composition',
          message: `Level horizon (${tilt > 0 ? 'tilt left' : 'tilt right'} ${Math.abs(tilt).toFixed(1)}°)`,
          icon: '📐',
          visualCue: tilt > 0 ? 'rotate-ccw' : 'rotate-cw',
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
        tips.push({
          id: 'rot-x',
          priority: 'medium',
          category: 'composition',
          message:
            offsetX > 0
              ? 'Pan right to align subject with grid line'
              : 'Pan left to align subject with grid line',
          icon: '🎯',
          visualCue: offsetX > 0 ? 'arrow-right' : 'arrow-left',
        });
      }

      // Headroom check (portrait)
      const headroom = face.bounds.y;
      if (headroom < COMPOSITION_RULES.HEADROOM.portraitMin) {
        tips.push({
          id: 'headroom-tight',
          priority: 'high',
          category: 'composition',
          message: 'Too tight above head — tilt up slightly',
          icon: '👤',
          visualCue: 'arrow-up',
        });
      } else if (headroom > COMPOSITION_RULES.HEADROOM.portraitMax * 2) {
        tips.push({
          id: 'headroom-loose',
          priority: 'medium',
          category: 'composition',
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
          tips.push({
            id: 'looking-room',
            priority: 'medium',
            category: 'composition',
            message: `Leave more space where subject is looking`,
            icon: '👀',
            visualCue: face.eyeDirection === 'right' ? 'arrow-left' : 'arrow-right',
          });
        }
      }
    }

    // Fill the frame check
    if (a.scene === 'portrait' && a.faces[0]) {
      const faceArea = a.faces[0].bounds.width * a.faces[0].bounds.height;
      if (faceArea < 0.08) {
        tips.push({
          id: 'get-closer',
          priority: 'medium',
          category: 'composition',
          message: 'Get closer — fill the frame with your subject',
          icon: '🔍',
          visualCue: 'step-closer',
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
        message: 'Low light — brace against something stable',
        icon: '🌙',
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
          message: 'Too shaky — brace elbows against your body',
          icon: '🤳',
        },
      ];
    }
    if (a.motion > 0.15 && a.lighting.averageLuminance < 0.3) {
      return [
        {
          id: 'shaky-low-light',
          priority: 'critical',
          category: 'motion',
          message: 'Low light + movement = blur. Hold steady!',
          icon: '⚠️',
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
          message: 'Wait for a subject to enter the frame',
          icon: '🚶',
        });
        break;

      case 'macro':
        tips.push({
          id: 'macro-focus',
          priority: 'medium',
          category: 'pro-tip',
          message: 'Focus stack: tap different points for depth',
          icon: '🌸',
        });
        break;

      case 'night':
        tips.push({
          id: 'night-tripod',
          priority: 'medium',
          category: 'pro-tip',
          message: 'Rest phone on stable surface for long exposure',
          icon: '🌃',
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
          message: '📸 SHOOT NOW — everything is aligned!',
          icon: '⚡',
          visualCue: 'shoot-now',
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
          message: '🎨 Beautiful composition!',
          icon: '⭐',
        },
      ];
    }
    return [];
  }

  private priorityWeight(p: Suggestion['priority']): number {
    return { critical: 100, high: 80, medium: 60, low: 40, praise: 30 }[p];
  }
}
