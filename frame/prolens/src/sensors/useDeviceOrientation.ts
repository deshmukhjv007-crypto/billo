import { useEffect, useRef } from 'react';
import { DeviceMotion } from 'expo-sensors';
import { useSharedValue } from 'react-native-worklets-core';
import type { ISharedValue } from 'react-native-worklets-core';

export interface MotionData {
  tilt: number; // Horizon tilt in degrees (-180 to 180)
  motion: number; // Gyroscope motion magnitude (0 = still, >0.2 = shaky)
}

export interface DeviceOrientation {
  /** Latest reading, live on the JS thread (for non-worklet readers). */
  motionRef: { current: MotionData };
  /** Worklet-live tilt — read `.value` inside frame processors. */
  tilt: ISharedValue<number>;
  /** Worklet-live motion — read `.value` inside frame processors. */
  motion: ISharedValue<number>;
}

export function useDeviceOrientation(): DeviceOrientation {
  const motionRef = useRef<MotionData>({ tilt: 0, motion: 0 });
  // Plain refs are snapshotted when a worklet closure is created, so the
  // frame processor cannot observe ref updates — mirror into shared values.
  const tilt = useSharedValue(0);
  const motion = useSharedValue(0);

  useEffect(() => {
    DeviceMotion.setUpdateInterval(50); // 20Hz update rate
    const subscription = DeviceMotion.addListener((data) => {
      if (data.rotation == null) return;

      // Extract roll (tilt) in degrees.
      // TODO: validate the rotation-axis mapping on physical devices — the
      // correct axis depends on device orientation (portrait/landscape).
      const rollRad = data.rotation.beta ?? 0; // Roll angle (radians)
      const tiltDegrees = (rollRad * 180) / Math.PI;

      // Calculate motion instability from acceleration (m/s^2, normalized by g)
      const acc = data.acceleration;
      const ax = acc?.x ?? 0;
      const ay = acc?.y ?? 0;
      const az = acc?.z ?? 0;
      const instability =
        Math.sqrt(ax * ax + ay * ay + az * az) / DeviceMotion.Gravity;

      const next: MotionData = {
        tilt: parseFloat(tiltDegrees.toFixed(1)),
        motion: parseFloat(instability.toFixed(2)),
      };
      motionRef.current = next;
      tilt.value = next.tilt;
      motion.value = next.motion;
    });

    return () => subscription.remove();
  }, [motion, tilt]);

  return { motionRef, tilt, motion };
}
