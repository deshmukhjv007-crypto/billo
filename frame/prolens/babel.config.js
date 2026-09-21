module.exports = function (api) {
  api.cache(true);
  return {
    presets: ['babel-preset-expo'],
    plugins: [
      // Compiles 'worklet' functions for the worklets-core runtime that
      // vision-camera frame processors run on. Must come BEFORE the
      // Reanimated plugin.
      'react-native-worklets-core/plugin',
      // Reanimated drives the HUD animations (spirit level, direction
      // overlay pulses, pill transitions). Its plugin must stay LAST —
      // see https://react-native-vision-camera.com/docs/guides/frame-processors
      // for the required ordering next to worklets-core. Re-verify on-device
      // that frame processors still run after changing this list.
      'react-native-reanimated/plugin',
    ],
  };
};
