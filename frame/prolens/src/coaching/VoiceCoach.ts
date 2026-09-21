import * as Speech from 'expo-speech';
import type { Suggestion } from './SuggestionEngine';

export class VoiceCoach {
  private isEnabled: boolean = true;
  private isSpeaking: boolean = false;
  private lastSpokenMessage: string = '';
  private lastSpokenTime: number = 0;
  private readonly MIN_SPEECH_INTERVAL_MS = 3500; // Prevent chatter

  constructor(enabled: boolean = true) {
    this.isEnabled = enabled;
  }

  public setEnabled(enabled: boolean) {
    this.isEnabled = enabled;
    if (!enabled) {
      Speech.stop();
    }
  }

  public getIsEnabled(): boolean {
    return this.isEnabled;
  }

  public getIsSpeaking(): boolean {
    return this.isSpeaking;
  }

  /**
   * Evaluates current suggestions and speaks critical or high-priority tips.
   */
  public speakSuggestion(suggestions: Suggestion[]) {
    if (!this.isEnabled || suggestions.length === 0) return;

    // Focus on top priority suggestion
    const top = suggestions[0];
    const now = Date.now();

    // Skip low-priority or praise suggestions for voice to keep audio clean
    if (top.priority === 'low' || top.priority === 'praise') return;

    // Debounce duplicate speech
    if (
      top.message === this.lastSpokenMessage &&
      now - this.lastSpokenTime < this.MIN_SPEECH_INTERVAL_MS * 2
    ) {
      return;
    }

    // Rate-limit consecutive speech
    if (now - this.lastSpokenTime < this.MIN_SPEECH_INTERVAL_MS) {
      return;
    }

    this.speak(top.message, top.priority === 'critical');
  }

  private speak(text: string, isCritical: boolean) {
    if (isCritical) {
      Speech.stop(); // Intercept active speech for critical alerts
    }

    this.lastSpokenMessage = text;
    this.lastSpokenTime = Date.now();
    this.isSpeaking = true;

    Speech.speak(text, {
      language: 'en-US',
      pitch: 1.0,
      rate: 1.1, // Slightly brisk for real-time responsiveness
      onDone: () => {
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
