import React from 'react';
import {
  View,
  Text,
  StyleSheet,
  Image,
  TouchableOpacity,
  ScrollView,
  Dimensions,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import * as Haptics from 'expo-haptics';
import * as MediaLibrary from 'expo-media-library';
import type { FrameAnalysis } from '../ai/SceneAnalyzer';

const { width } = Dimensions.get('window');

interface ReviewScreenProps {
  photoPath: string;
  analysis: FrameAnalysis;
  onRetake: () => void;
  onOpenGallery: () => void;
}

export function ReviewScreen({
  photoPath,
  analysis,
  onRetake,
  onOpenGallery,
}: ReviewScreenProps) {
  const [saved, setSaved] = React.useState(false);
  const [saving, setSaving] = React.useState(false);
  const [saveError, setSaveError] = React.useState<string | null>(null);

  // The live HUD hides numbers on purpose; this is where the score lives.
  const overallScore = Math.round(analysis.composition.overallScore * 100);

  const saveToGallery = async () => {
    if (saving || saved) return;
    setSaving(true);
    setSaveError(null);
    try {
      // writeOnly: saving only needs "add" access, never the whole library
      // (the Gallery screen asks for read access separately, when opened).
      const permission = await MediaLibrary.requestPermissionsAsync(true);
      if (!permission.granted) {
        setSaveError(
          permission.canAskAgain
            ? 'Photo access is needed to save.'
            : 'Photo access is blocked — enable it in Settings.'
        );
        return;
      }
      await MediaLibrary.saveToLibraryAsync(`file://${photoPath}`);
      setSaved(true);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
    } catch (err) {
      console.error('Failed to save photo:', err);
      setSaveError('Could not save the photo. Please try again.');
    } finally {
      setSaving(false);
    }
  };

  const getScoreColor = (score: number) => {
    if (score >= 85) return '#00FF88';
    if (score >= 70) return '#007AFF';
    if (score >= 50) return '#FF9500';
    return '#FF3B30';
  };

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView contentContainerStyle={styles.scrollContent}>
        {/* Header */}
        <View style={styles.header}>
          <TouchableOpacity onPress={onRetake} style={styles.backButton}>
            <Text style={styles.backText}>‹ Retake</Text>
          </TouchableOpacity>
          <Text style={styles.title}>Prolens AI Critique</Text>
          <View style={{ width: 60 }} />
        </View>

        {/* Captured Image View */}
        <View style={styles.imageContainer}>
          <Image source={{ uri: `file://${photoPath}` }} style={styles.image} />
          <View
            style={[styles.scoreBadge, { borderColor: getScoreColor(overallScore) }]}
          >
            <Text
              style={[styles.scoreNumber, { color: getScoreColor(overallScore) }]}
            >
              {overallScore}
            </Text>
            <Text style={styles.scoreLabel}>PRO SCORE</Text>
          </View>
        </View>

        {/* Critique Breakdown */}
        <View style={styles.card}>
          <Text style={styles.cardTitle}>📊 Composition Metrics</Text>

          <MetricRow
            label="Rule of Thirds"
            value={analysis.composition.ruleOfThirds}
            comment={
              analysis.composition.ruleOfThirds > 0.75
                ? 'Excellent alignment'
                : 'Subject off grid'
            }
          />
          <MetricRow
            label="Horizon Level"
            value={analysis.composition.horizonLevel}
            comment={
              Math.abs(analysis.horizon.tilt) < 1.5
                ? 'Perfectly level'
                : `Tilted ${Math.abs(analysis.horizon.tilt).toFixed(1)}° — ${
                    analysis.horizon.tilt > 0 ? 'tilt left' : 'tilt right'
                  } next time`
            }
          />
          <MetricRow
            label="Handheld Stability"
            value={Math.max(0, 1 - analysis.motion)}
            comment={
              analysis.motion < 0.1 ? 'Razor sharp' : 'Slight camera movement'
            }
          />
        </View>

        {/* Exposure & Zone System Card */}
        <View style={styles.card}>
          <Text style={styles.cardTitle}>☀️ Zone System Exposure</Text>
          <Text style={styles.cardSubtitle}>
            Average Luminance: {(analysis.lighting.averageLuminance * 100).toFixed(0)}%
          </Text>
          <Text style={styles.cardSubtitle}>
            Highlights Clipped:{' '}
            {(analysis.lighting.clippedHighlights * 100).toFixed(1)}%
          </Text>
          {analysis.lighting.isBacklit && (
            <View style={styles.warningBox}>
              <Text style={styles.warningText}>
                ☀️ Backlit scene detected & adjusted
              </Text>
            </View>
          )}
        </View>

        {/* Action Buttons: primary Save · secondary Retake · text View Gallery */}
        <View style={styles.actions}>
          <TouchableOpacity
            style={[styles.saveButton, saved && styles.savedButton]}
            onPress={saveToGallery}
            disabled={saved || saving}
            accessibilityRole="button"
          >
            <Text style={styles.saveText}>
              {saved ? '✓ Saved to Photos' : saving ? 'Saving…' : 'Save'}
            </Text>
          </TouchableOpacity>
          {saveError && <Text style={styles.errorText}>{saveError}</Text>}

          <TouchableOpacity
            style={styles.secondaryButton}
            onPress={onRetake}
            accessibilityRole="button"
          >
            <Text style={styles.secondaryText}>Retake</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={styles.textButton}
            onPress={onOpenGallery}
            accessibilityRole="button"
          >
            <Text style={styles.textButtonText}>View Gallery</Text>
          </TouchableOpacity>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

function MetricRow({
  label,
  value,
  comment,
}: {
  label: string;
  value: number;
  comment: string;
}) {
  const pct = Math.round(value * 100);
  return (
    <View style={styles.metricRow}>
      <View style={styles.metricLabelContainer}>
        <Text style={styles.metricLabel}>{label}</Text>
        <Text style={styles.metricComment}>{comment}</Text>
      </View>
      <View style={styles.barBackground}>
        <View style={[styles.barFill, { width: `${pct}%` }]} />
      </View>
      <Text style={styles.metricPct}>{pct}%</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0B0B0E' },
  scrollContent: { padding: 20 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 20,
  },
  backButton: { paddingVertical: 8, paddingRight: 12 },
  backText: { color: '#007AFF', fontSize: 18, fontWeight: '600' },
  title: { color: 'white', fontSize: 18, fontWeight: '700' },
  imageContainer: {
    width: width - 40,
    height: (width - 40) * 1.33, // 4:3 Aspect ratio
    borderRadius: 20,
    overflow: 'hidden',
    marginBottom: 20,
    position: 'relative',
  },
  image: { width: '100%', height: '100%' },
  scoreBadge: {
    position: 'absolute',
    top: 16,
    right: 16,
    backgroundColor: 'rgba(0,0,0,0.85)',
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 16,
    borderWidth: 2,
    alignItems: 'center',
  },
  scoreNumber: { fontSize: 28, fontWeight: '900' },
  scoreLabel: {
    color: '#8E8E93',
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 1,
  },
  card: {
    backgroundColor: '#1C1C1E',
    borderRadius: 16,
    padding: 16,
    marginBottom: 16,
  },
  cardTitle: { color: 'white', fontSize: 16, fontWeight: '700', marginBottom: 12 },
  cardSubtitle: { color: '#A1A1A6', fontSize: 14, marginBottom: 4 },
  metricRow: { marginBottom: 12 },
  metricLabelContainer: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 4,
  },
  metricLabel: { color: 'white', fontSize: 14, fontWeight: '600' },
  metricComment: { color: '#8E8E93', fontSize: 12 },
  barBackground: {
    height: 6,
    backgroundColor: '#2C2C2E',
    borderRadius: 3,
    overflow: 'hidden',
  },
  barFill: { height: '100%', backgroundColor: '#00FF88', borderRadius: 3 },
  metricPct: { color: '#8E8E93', fontSize: 11, marginTop: 2, textAlign: 'right' },
  warningBox: {
    backgroundColor: 'rgba(255,149,0,0.15)',
    padding: 10,
    borderRadius: 8,
    marginTop: 8,
  },
  warningText: { color: '#FF9500', fontSize: 13, fontWeight: '600' },
  actions: { gap: 12, marginTop: 10, marginBottom: 30 },
  saveButton: {
    backgroundColor: '#00FF88',
    paddingVertical: 16,
    borderRadius: 30,
    alignItems: 'center',
  },
  savedButton: { backgroundColor: '#34C759' },
  saveText: { color: 'black', fontSize: 16, fontWeight: '700' },
  secondaryButton: {
    backgroundColor: '#2C2C2E',
    paddingVertical: 16,
    borderRadius: 30,
    alignItems: 'center',
  },
  secondaryText: { color: 'white', fontSize: 16, fontWeight: '600' },
  textButton: { paddingVertical: 12, alignItems: 'center' },
  textButtonText: { color: '#0A84FF', fontSize: 16, fontWeight: '600' },
  errorText: { color: '#FF453A', fontSize: 13, textAlign: 'center' },
});
