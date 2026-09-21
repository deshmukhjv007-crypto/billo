module.exports = function (api) {
  api.cache(true);
  return {
    presets: ['babel-preset-expo'],
    plugins: [
      // Compiles 'worklet' functions for the worklets-core runtime that
      // vision-camera frame processors run on. NOTE: react-native-reanimated
      // is installed but not imported anywhere yet — when it is, re-add its
      // plugin AFTER this one ('react-native-reanimated/plugin' must stay
      // last) and re-verify on-device that frame processors still run.
      'react-native-worklets-core/plugin',
    ],
  };
};
