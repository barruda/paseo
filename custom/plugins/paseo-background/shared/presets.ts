function scenery(sky: string, glow: string, far: string, near: string, sun: string, shape: number) {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1920" height="1200" viewBox="0 0 1920 1200"><defs><linearGradient id="s" x2=".7" y2="1"><stop stop-color="${sky}"/><stop offset="1" stop-color="${glow}"/></linearGradient><radialGradient id="g"><stop stop-color="${sun}" stop-opacity=".65"/><stop offset="1" stop-color="${sun}" stop-opacity="0"/></radialGradient><linearGradient id="f" x2="0" y2="1"><stop stop-color="${far}"/><stop offset="1" stop-color="${near}"/></linearGradient></defs><path fill="url(#s)" d="M0 0h1920v1200H0z"/><ellipse cx="${shape === 1 ? 1450 : 480}" cy="290" rx="720" ry="580" fill="url(#g)"/><circle cx="${shape === 1 ? 1450 : 480}" cy="290" r="${shape === 2 ? 68 : 110}" fill="${sun}" opacity=".6"/><path d="M0 690Q290 ${shape === 1 ? 230 : 650} 580 610T1200 590T1920 520V1200H0Z" fill="${far}" opacity=".48"/><path d="M0 850Q350 480 780 760T1500 730T1920 720V1200H0Z" fill="url(#f)" opacity=".8"/><path d="M0 1020Q390 760 900 1010T1920 840V1200H0Z" fill="${near}"/></svg>`;
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

export const presets = [
  { id: "forest", name: "Forest mist", zh: "山岚", colors: ["#153d42", "#799d99"], uri: scenery("#163e4b", "#a6bbad", "#315e5c", "#122d36", "#dddfbb", 1) },
  { id: "dunes", name: "Quiet dunes", zh: "沙丘", colors: ["#925d50", "#e3b98f"], uri: scenery("#565375", "#e2b592", "#b57e68", "#694e54", "#f9dfbb", 0) },
  { id: "alpine", name: "Alpine blue", zh: "远山", colors: ["#304968", "#a9c8db"], uri: scenery("#587ba2", "#c0d7df", "#62829c", "#233f61", "#e2e9d9", 1) },
  { id: "night", name: "After hours", zh: "入夜", colors: ["#171f43", "#70678c"], uri: scenery("#141c3d", "#6f6883", "#424368", "#141f34", "#d6d5de", 2) },
  { id: "coast", name: "Tidal light", zh: "海岸", colors: ["#2d6c7b", "#b8c8b1"], uri: scenery("#467b8e", "#c9d0b0", "#6c9c9c", "#235361", "#f0e9ce", 0) },
  { id: "plum", name: "Evening haze", zh: "暮色", colors: ["#67425e", "#bc9bab"], uri: scenery("#594467", "#c3a2a7", "#91697d", "#402e48", "#edd0bc", 1) },
] as const;

export const presetIds = presets.map((preset) => preset.id);
