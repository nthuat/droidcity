// Per-app brand hues, Material 300s, all clear of Android green (0x3ddc84,
// reserved for 'alive/running'). Single source for launcher icons, display
// screen tiles, and anything else that colors by app.
export const APP_COLORS: Record<string, number> = {
  chat: 0xffb74d,
  maps: 0x4dd0e1,
  camera: 0x64b5f6,
  bank: 0x9575cd,
}
export const APP_COLOR_FALLBACK = 0xe8eaed
