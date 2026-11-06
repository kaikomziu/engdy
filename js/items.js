// ガチャの景品：図鑑（ことば図鑑）・背景・テーマ
export const RARITY = {
  N:   { label: "N",   rate: 55,  color: "#cfd8e3", orb: "#cfd8e3", ray: "rgba(255,255,255,.5)" },
  R:   { label: "R",   rate: 30,  color: "#4fa3ff", orb: "#5aa9ff", ray: "rgba(90,169,255,.7)" },
  SR:  { label: "SR",  rate: 11,  color: "#b45cff", orb: "#c27bff", ray: "rgba(194,123,255,.8)" },
  SSR: { label: "SSR", rate: 3.5, color: "#ffb52e", orb: "#ffc94d", ray: "rgba(255,201,77,.9)" },
  UR:  { label: "UR",  rate: 0.5, color: "#ff4fa0", orb: "#ffffff", ray: "rgba(255,255,255,.95)" },
};
export const ORDER = ["N", "R", "SR", "SSR", "UR"];
export const COST1 = 50, COST10 = 450, PITY = 50, DUP_REFUND = 10;

// 図鑑：英単語そのものを集める（例文つき）
const D = (id, r, icon, en, ja, ex) => ({ id, type: "dex", r, icon, en, ja, ex });
export const DEX = [
  D("apple", "N", "🍎", "Apple", "りんご", "An apple a day keeps the doctor away."),
  D("book", "N", "📘", "Book", "本", "I read a book every night."),
  D("cat", "N", "🐱", "Cat", "ねこ", "The cat is sleeping on the sofa."),
  D("dog", "N", "🐶", "Dog", "いぬ", "My dog loves to run."),
  D("sun", "N", "☀️", "Sun", "太陽", "The sun rises in the east."),
  D("moon", "N", "🌙", "Moon", "月", "The moon is bright tonight."),
  D("tree", "N", "🌳", "Tree", "木", "Birds live in this tree."),
  D("fish", "N", "🐟", "Fish", "魚", "Fish swim in the river."),
  D("bread", "N", "🍞", "Bread", "パン", "She bakes bread on Sundays."),
  D("rain", "N", "🌧️", "Rain", "雨", "It may rain tomorrow."),
  D("star", "N", "⭐", "Star", "星", "Look at that shining star."),
  D("cup", "N", "☕", "Cup", "カップ", "Would you like a cup of tea?"),
  D("key", "N", "🔑", "Key", "かぎ", "I lost my key."),
  D("bell", "N", "🔔", "Bell", "ベル", "The bell rang at noon."),
  D("leaf", "N", "🍃", "Leaf", "葉", "A leaf fell from the tree."),
  D("egg", "N", "🥚", "Egg", "たまご", "I had an egg for breakfast."),
  D("hat", "N", "🎩", "Hat", "帽子", "He wears a black hat."),
  D("shoe", "N", "👟", "Shoe", "くつ", "My shoe is untied."),
  D("pencil", "N", "✏️", "Pencil", "えんぴつ", "May I borrow your pencil?"),
  D("clock", "N", "⏰", "Clock", "時計", "The clock says seven."),
  D("rainbow", "R", "🌈", "Rainbow", "にじ", "A rainbow appeared after the rain."),
  D("compass", "R", "🧭", "Compass", "方位磁針", "A compass always points north."),
  D("lantern", "R", "🏮", "Lantern", "ちょうちん、ランタン", "The lantern lit up the path."),
  D("telescope", "R", "🔭", "Telescope", "望遠鏡", "We saw Saturn through a telescope."),
  D("violin", "R", "🎻", "Violin", "バイオリン", "She plays the violin beautifully."),
  D("penguin", "R", "🐧", "Penguin", "ペンギン", "Penguins can't fly, but they swim well."),
  D("owl", "R", "🦉", "Owl", "フクロウ", "The owl is a symbol of wisdom."),
  D("cactus", "R", "🌵", "Cactus", "サボテン", "A cactus needs little water."),
  D("volcano", "R", "🌋", "Volcano", "火山", "The volcano erupted last year."),
  D("island", "R", "🏝️", "Island", "島", "They live on a small island."),
  D("sailboat", "R", "⛵", "Sailboat", "帆船", "A sailboat moved across the bay."),
  D("hedgehog", "R", "🦔", "Hedgehog", "ハリネズミ", "The hedgehog rolled into a ball."),
  D("journey", "R", "🧳", "Journey", "旅", "Life is a long journey."),
  D("harmony", "R", "🎼", "Harmony", "調和", "They sang in perfect harmony."),
  D("dragon", "SR", "🐉", "Dragon", "ドラゴン、竜", "The dragon guarded its treasure."),
  D("unicorn", "SR", "🦄", "Unicorn", "ユニコーン", "A unicorn has a single horn."),
  D("crystal", "SR", "💎", "Crystal", "水晶、結晶", "The water was crystal clear."),
  D("comet", "SR", "☄️", "Comet", "すい星", "A comet passed by the earth."),
  D("galaxy", "SR", "🌌", "Galaxy", "銀河", "Our galaxy is called the Milky Way."),
  D("castle", "SR", "🏰", "Castle", "城", "The king lived in a castle."),
  D("crown", "SR", "👑", "Crown", "王冠", "The queen wore a golden crown."),
  D("courage", "SR", "🦁", "Courage", "勇気", "It takes courage to say no."),
  D("serendipity", "SSR", "✨", "Serendipity", "思いがけない幸運な発見", "Finding this café was pure serendipity."),
  D("eureka", "SSR", "💡", "Eureka", "わかった！（発見の喜び）", "Eureka! I solved the puzzle."),
  D("wanderlust", "SSR", "🗺️", "Wanderlust", "旅への強いあこがれ", "Her wanderlust took her around the world."),
  D("euphoria", "SSR", "🎆", "Euphoria", "幸福感、高揚感", "The team was in euphoria after the win."),
  D("infinity", "UR", "♾️", "Infinity", "無限", "The universe seems to stretch to infinity."),
  D("engdy", "UR", "🌟", "Engdy", "英語を毎日（このアプリ）", "Learn a little English every day with Engdy."),
];

// 背景（画面の後ろに敷く）
const B = (id, r, name, ja, css, anim) => ({ id, type: "bg", r, name, ja, css, anim });
export const BGS = [
  B("plain", "-", "Plain", "なし", "none"),
  B("grid", "R", "Grid", "方眼ノート", "linear-gradient(var(--line) 1px,transparent 1px) 0 0/24px 24px, linear-gradient(90deg,var(--line) 1px,transparent 1px) 0 0/24px 24px"),
  B("dots", "R", "Dots", "ドット", "radial-gradient(var(--line) 1.4px,transparent 1.6px) 0 0/18px 18px"),
  B("ruled", "R", "Ruled", "罫線ノート", "linear-gradient(transparent 31px,color-mix(in srgb,var(--accent) 22%,transparent) 32px) 0 0/100% 32px"),
  B("dusk", "SR", "Dusk", "夕暮れ", "linear-gradient(180deg,#f7d9c4 0%,#f3e6d8 45%,transparent 100%)"),
  B("sea", "SR", "Sea", "海", "linear-gradient(180deg,transparent 40%,#cfe5ee 100%), radial-gradient(ellipse at 50% 120%,#a9d2e3,transparent 60%)"),
  B("night", "SR", "Night Sky", "夜空", "radial-gradient(1px 1px at 20% 30%,#fff,transparent), radial-gradient(1px 1px at 70% 20%,#fff,transparent), radial-gradient(1.5px 1.5px at 40% 70%,#fff,transparent), radial-gradient(1px 1px at 85% 60%,#fff,transparent), linear-gradient(#1c2340,#2d3561)"),
  B("sakura", "SSR", "Sakura", "桜", "radial-gradient(circle at 10% 20%,#f9d5e0 0 6px,transparent 7px) 0 0/90px 90px, radial-gradient(circle at 60% 70%,#fbe3ea 0 4px,transparent 5px) 0 0/70px 70px, linear-gradient(#fff6f8,#fdeef2)", "drift"),
  B("aurora", "SSR", "Aurora", "オーロラ", "linear-gradient(120deg,rgba(80,220,180,.35),rgba(120,140,255,.3),rgba(220,120,255,.3),rgba(80,220,180,.35))", "aurora"),
  B("nebula", "UR", "Nebula", "星雲", "radial-gradient(circle at 30% 40%,rgba(255,90,170,.35),transparent 40%), radial-gradient(circle at 70% 60%,rgba(90,140,255,.4),transparent 45%), radial-gradient(circle at 50% 20%,rgba(120,255,220,.25),transparent 40%), #12142a", "aurora"),
];

// テーマ（色）
const T = (id, r, name, ja, v) => ({ id, type: "theme", r, name, ja, v });
export const THEMES = [
  T("forest", "-", "Forest", "森（はじめから）", {}),
  T("ocean", "R", "Ocean", "海の青", { "--accent": "#2d5f8a", "--accent-soft": "#e2ebf3" }),
  T("akane", "R", "Akane", "茜", { "--accent": "#b4553a", "--accent-soft": "#f5e6df" }),
  T("fuji", "R", "Fuji", "藤", { "--accent": "#6a5a9c", "--accent-soft": "#ebe7f4" }),
  T("matcha", "SR", "Matcha", "抹茶", { "--accent": "#5f7d2e", "--accent-soft": "#ebf0df", "--bg": "#f3f2e7", "--paper": "#fcfbf2" }),
  T("sumi", "SR", "Sumi", "墨（ダーク）", { "--bg": "#1b1e1d", "--paper": "#242827", "--ink": "#e8ebe9", "--sub": "#9aa5a0", "--line": "#353b39", "--accent": "#7cc4a8", "--accent-soft": "#2c3a35" }),
  T("gold", "SSR", "Gold", "金", { "--accent": "#a8811f", "--accent-soft": "#f5ecd5", "--bg": "#f7f3e8", "--paper": "#fffcf3" }),
  T("midnight", "SSR", "Midnight", "真夜中", { "--bg": "#141a2e", "--paper": "#1c2340", "--ink": "#eef0f8", "--sub": "#9aa3c4", "--line": "#2c3558", "--accent": "#e2b94f", "--accent-soft": "#2a3152" }),
];

export const ALL = [...DEX, ...BGS.filter((b) => b.r !== "-"), ...THEMES.filter((t) => t.r !== "-")];
export const byId = (type, id) => (type === "dex" ? DEX : type === "bg" ? BGS : THEMES).find((x) => x.id === id);
export const itemName = (it) => (it.type === "dex" ? it.en : it.ja);
export const itemIcon = (it) => (it.type === "dex" ? it.icon : it.type === "bg" ? "🖼️" : "🎨");
export const itemSub = (it) => (it.type === "dex" ? it.ja : it.type === "bg" ? "背景" : "テーマ");
