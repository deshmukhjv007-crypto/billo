import * as Speech from 'expo-speech';
import type { Suggestion } from './SuggestionEngine';

/**
 * Optional spoken coaching. OFF by default — the HUD (spirit level, chevrons,
 * pills) is the primary channel; voice is an opt-in from the settings tray.
 *
 * When enabled it speaks the suggestion's short `label` ("Tilt left",
 * "Pan right", "Hold steady", "Shoot now"), never the long message.
 */
export class VoiceCoach {
  private isEnabled: boolean = false;
  private isSpeaking: boolean = false;
  private lastSpokenText: string = '';
  private lastSpokenTime: number = 0;
  private readonly MIN_SPEECH_INTERVAL_MS = 3500; // Prevent chatter

  constructor(enabled: boolean = false) {
    this.isEnabled = enabled;
  }

  public setEnabled(enabled: boolean) {
    this.isEnabled = enabled;
    if (!enabled) {
      this.stop();
    }
  }

  public getIsEnabled(): boolean {
    return this.isEnabled;
  }

  public getIsSpeaking(): boolean {
    return this.isSpeaking;
  }

  /**
   * Evaluates current suggestions and speaks the top critical/high/medium tip
   * as a short command. No-op while disabled.
   */
  public speakSuggestion(suggestions: Suggestion[]) {
    if (!this.isEnabled || suggestions.length === 0) return;

    // Focus on top priority suggestion
    const top = suggestions[0];
    const now = Date.now();

    // Skip low-priority or praise suggestions for voice to keep audio clean
    if (top.priority === 'low' || top.priority === 'praise') return;

    const text = VoiceCoach.phraseFor(top);

    // Debounce duplicate speech
    if (
      text === this.lastSpokenText &&
      now - this.lastSpokenTime < this.MIN_SPEECH_INTERVAL_MS * 2
    ) {
      return;
    }

    // Rate-limit consecutive speech
    if (now - this.lastSpokenTime < this.MIN_SPEECH_INTERVAL_MS) {
      return;
    }

    this.speak(text, top.priority === 'critical');
  }

  /** Short spoken form of a suggestion — the label, with a couple of overrides. */
  static phraseFor(s: Suggestion): string {
    switch (s.visualCue) {
      case 'rotate-ccw':
        return 'Tilt left';
      case 'rotate-cw':
        return 'Tilt right';
      case 'arrow-left':
        return 'Pan left';
      case 'arrow-right':
        return 'Pan right';
      case 'arrow-up':
        return 'Tilt up';
      case 'arrow-down':
        return 'Tilt down';
      case 'step-closer':
        return 'Step closer';
      case 'step-back':
        return 'Step back';
      case 'wait':
        return 'Hold steady';
      case 'shoot-now':
        return 'Shoot now';
      default:
        return s.label;
    }
  }

  private speak(text: string, isCritical: boolean) {
    if (isCritical) {
      Speech.stop(); // Intercept active speech for critical alerts
    }

    this.lastSpokenText = text;
    this.lastSpokenTime = Date.now();
    this.isSpeaking = true;

    Speech.speak(text, {
      language: 'en-US',
      pitch: 1.0,
      rate: 1.1, // Slightly brisk for real-time responsiveness
      onDone: () => {
        this.isSpeaking = false;
      },
      onStopped: () => {
        this.isSpeaking = false;
      },
      onError: () => {
        this.isSpeaking = false;
      },
    });
  }

  public stop() {
    Speech.stop();
    this.isSpeaking = false;
  }
}
