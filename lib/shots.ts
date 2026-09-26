/**
 * Prompts for the AI-generated shots in an ad. Each dish scene tells a short
 * story, all generated from text except the hero shot (the dish photo brought
 * to life):
 *
 *   fire     the dramatic moment of cooking: flames, sizzle, sparks
 *   plating  the finishing touch: sauce pour, garnish, cheese pull
 *   hero     the dish itself (image-to-video from the photo)
 *   bite     someone taking the first bite and loving it
 *
 * The intro opens in the kitchen and the end card sits over friends toasting.
 *
 * Actions are matched to the kind of dish, because video models render specific
 * motion ("patty smashed on a griddle") far better than generic "cooking".
 */

export type ShotKind = "fire" | "plating" | "hero" | "bite" | "kitchen" | "cheers" | "serving" | "socializing";

/** Dark, high-contrast food-commercial look for the kitchen shots. */
const DRAMA =
  "Dramatic high-end food commercial. Dark moody kitchen, low-key lighting with a hard warm rim light, black background, embers and steam catching the light, extreme close-up, high-speed slow motion at 120fps, shallow depth of field, shot on cinema camera, photorealistic";
/** Warm, intimate look for the people shots. */
const WARM =
  "Cinematic restaurant commercial. Warm candlelight and soft tungsten glow, creamy bokeh of string lights behind, shallow depth of field, gentle slow motion, shot on cinema camera, photorealistic";
const CLEAN = "No text, no logos, no watermark.";
const PEOPLE = "Candid and natural, realistic faces and hands with correct anatomy, genuine emotion, nobody looks at the camera.";

/** Where a dish is made and enjoyed: sets who's in the shot and the intro/end-card footage. */
export type Setting = "kitchen" | "cafe" | "bar";

interface DishActions {
  /** What to search stock footage for. */
  food: string;
  /** Words a stock clip's title must contain to count as footage of this food. */
  match: RegExp;
  /** Defaults to "kitchen". */
  setting?: Setting;
  /** Stock searches when "<food> cooking" / "people eating <food>" don't fit (drinks, bakery). */
  stock?: { fire: string[]; plating: string[]; bite: string[] };
  /** The dramatic cooking moment. */
  fire: string;
  /** The finishing touch. */
  plating: string;
  /** How someone eats it. */
  bite: string;
}

/** [keywords, actions] – first match wins. */
const ACTIONS: [RegExp, DishActions][] = [
  [/coffee|espresso|latte|cappuccino|americano|macchiato|mocha|cortado|flat white|cold brew|affogato|frapp/i, {
    food: "coffee",
    match: /coffee|espresso|latte|cappuccino|barista|brew|milk|froth|cafe/,
    setting: "cafe",
    stock: {
      fire: ["barista making espresso", "espresso machine pouring", "pour over coffee brewing", "barista making coffee"],
      plating: ["latte art pouring", "barista pouring milk coffee", "iced coffee pouring milk"],
      bite: ["people drinking coffee together", "woman drinking coffee cafe", "friends coffee shop"],
    },
    fire: "a portafilter locks into a gleaming espresso machine and rich espresso streams into the cup in slow motion, crema swirling, steam rising",
    plating: "silky steamed milk is poured in a slow-motion ribbon, a latte-art rosetta blooms across the surface, ice cubes clink and swirl in a glass",
    bite: "a woman wraps both hands around her cup and takes a slow first sip, smiling at her friend across a sunny cafe table",
  }],
  [/\btea\b|matcha|chai|boba|bubble tea/i, {
    food: "tea",
    match: /tea|matcha|chai|boba/,
    setting: "cafe",
    stock: {
      fire: ["whisking matcha", "brewing tea", "pouring hot tea"],
      plating: ["pouring tea into cup", "matcha latte pouring", "bubble tea"],
      bite: ["people drinking tea together", "woman drinking tea", "friends drinking tea"],
    },
    fire: "a bamboo whisk froths vivid green matcha in a ceramic bowl, hot water pours from a kettle in a steaming arc",
    plating: "tea is poured into a glass in slow motion, milk clouds and swirls through it, ice settles",
    bite: "a woman lifts her cup and takes a sip, closing her eyes as steam curls past, her friend laughing beside her",
  }],
  [/smoothie|juice|lemonade|acai/i, {
    food: "smoothie",
    match: /smoothie|juice|blend|fruit|lemonade|acai/,
    setting: "cafe",
    stock: {
      fire: ["making smoothie blender", "fresh fruit juice", "blending smoothie"],
      plating: ["pouring smoothie into glass", "pouring juice"],
      bite: ["woman drinking smoothie", "people drinking juice"],
    },
    fire: "fresh fruit tumbles into a blender in slow motion and whirls into a vivid smoothie, droplets flying",
    plating: "the thick smoothie pours into a glass in a slow-motion ribbon, topped with fresh fruit and seeds",
    bite: "a woman sips through a straw and grins, sunlight catching the glass",
  }],
  [/cocktail|margarita|martini|mojito|spritz|negroni|old fashioned|sangria|mezcal/i, {
    food: "cocktail",
    match: /cocktail|bartender|martini|margarita|mojito|drink|shaker/,
    setting: "bar",
    stock: {
      fire: ["bartender making cocktail", "bartender shaking cocktail", "cocktail shaker"],
      plating: ["pouring cocktail into glass", "cocktail garnish"],
      bite: ["friends drinking cocktails", "people toasting cocktails bar"],
    },
    fire: "a bartender shakes a cocktail shaker hard, ice rattling, then strains it through a fine sieve",
    plating: "the cocktail pours into a chilled glass in slow motion, a citrus peel is twisted and oils spray",
    bite: "friends clink cocktail glasses and a woman takes a sip, laughing",
  }],
  [/\bbeer\b|\bipa\b|lager|stout|\bale\b|pilsner/i, {
    food: "beer",
    match: /beer|pint|tap|brew/,
    setting: "bar",
    stock: {
      fire: ["pouring beer from tap", "bartender pouring beer", "craft beer brewing"],
      plating: ["beer pouring into glass", "beer foam"],
      bite: ["friends drinking beer", "people toasting beer"],
    },
    fire: "golden beer pours from a brass tap into a pint glass, foam rising in slow motion",
    plating: "the pint is topped off and slid across the bar, condensation running down the glass",
    bite: "friends clink pints and take a long first sip, laughing together",
  }],
  [/\bwine\b|pinot|cabernet|merlot|chardonnay|prosecco|champagne|rosé|rose\b/i, {
    food: "wine",
    match: /wine|champagne|prosecco/,
    setting: "bar",
    stock: {
      fire: ["pouring wine", "sommelier pouring wine", "opening wine bottle"],
      plating: ["red wine pouring into glass", "wine glass swirl"],
      bite: ["friends drinking wine", "people toasting wine dinner"],
    },
    fire: "a cork is pulled and wine pours into a glass in a slow-motion ribbon, catching the candlelight",
    plating: "the wine is swirled in the glass, legs running down the side",
    bite: "friends raise their wine glasses in a toast and take a sip, smiling",
  }],
  [/croissant|bread|bagel|muffin|scone|baguette|sourdough|brioche|danish|cinnamon roll|pastry|pastries|biscuit/i, {
    food: "bakery",
    match: /bak|dough|bread|croissant|oven|pastr|flour|bagel/,
    setting: "cafe",
    stock: {
      fire: ["baker kneading dough", "bread baking in oven", "baker bakery"],
      plating: ["fresh bread out of oven", "croissants bakery", "breaking bread"],
      bite: ["eating croissant coffee", "woman eating pastry cafe", "people eating breakfast cafe"],
    },
    fire: "floured hands knead and fold dough on a wooden bench, flour puffs into the light, trays slide into a glowing oven",
    plating: "golden flaky pastries come out of the oven, a hand tears one open and steam escapes from the buttery layers",
    bite: "a woman tears off a flaky piece and eats it with a coffee in hand, crumbs falling, smiling at her friend",
  }],
  [/pancake|waffle|omelet|omelette|benedict|french toast|bacon|brunch|breakfast|avocado toast|\beggs?\b/i, {
    food: "breakfast",
    match: /egg|pancake|bacon|breakfast|brunch|waffle|toast/,
    setting: "cafe",
    stock: {
      fire: ["cooking eggs in pan", "making pancakes", "bacon frying in pan"],
      plating: ["pouring syrup on pancakes", "breakfast plate", "serving brunch"],
      bite: ["people eating breakfast together", "friends brunch", "family breakfast table"],
    },
    fire: "eggs crack into a sizzling buttered pan, bacon crackles and spits, a pancake is flipped high",
    plating: "maple syrup pours over a tall stack of pancakes in slow motion, butter melting, berries dropping on top",
    bite: "friends at a sunny brunch table dig in, a man takes a bite of pancakes and grins",
  }],
  [/pizza|flatbread|calzone/i, {
    food: "pizza",
    match: /pizza/,
    stock: {
      fire: ["pizza oven fire", "pizza cooking", "pizza in wood fired oven"],
      plating: ["pizza out of oven", "slicing pizza", "cutting pizza"],
      bite: ["people eating pizza", "friends eating pizza", "eating pizza"],
    },
    fire: "a pizza slides into a roaring wood-fired oven, flames curl across the dome and rush over the crust, embers swirl, cheese bubbles and blisters",
    plating: "a pizza peel pulls the blistered pizza from the oven, fresh basil and a drizzle of olive oil fall onto the molten cheese",
    bite: "a hand lifts a slice and long strings of melted cheese stretch; a woman takes a big bite and closes her eyes in delight",
  }],
  [/burger|smash|slider/i, {
    food: "burger",
    match: /burger|patty|patties/,
    fire: "a beef patty is smashed hard onto a scorching flat-top griddle, grease spits and smoke billows, edges sear dark and crisp, a flame flares",
    plating: "a slice of cheese melts and drips over the patty in slow motion, the burger is stacked and the glossy toasted bun is pressed on top",
    bite: "a man picks up the burger with both hands and takes a huge bite, juices drip, he nods and laughs with his mouth full",
  }],
  [/taco|burrito|quesadilla|fajita|tortilla/i, {
    food: "tacos",
    match: /taco|tortilla|burrito|mexican/,
    fire: "seasoned meat hits a smoking-hot plancha with a violent sizzle and a burst of flame, a cleaver chops it rapid-fire",
    plating: "meat is piled into warm tortillas, cilantro and onion rain down, a squeeze of lime sprays in slow motion",
    bite: "a woman leans in and takes a bite of a taco, salsa drips, she laughs and gives her friend a thumbs up",
  }],
  [/ramen|pho|noodle soup|udon/i, {
    food: "ramen",
    match: /ramen|noodle|broth|soup/,
    fire: "a wok erupts in a tower of flame as toppings are tossed, then boiling broth rolls violently in a huge steaming pot",
    plating: "noodles are lifted and shaken, glossy broth is poured into the bowl in slow motion, steam billows, a soft egg is placed on top",
    bite: "chopsticks lift noodles out of the steaming bowl, a man slurps them eagerly, steam rising around his smiling face",
  }],
  [/pasta|linguine|spaghetti|fettuccine|penne|rigatoni|gnocchi|ravioli|lasagna/i, {
    food: "pasta",
    match: /pasta|spaghetti|linguine|noodle/,
    fire: "a pan is tilted into the burner and bursts into a huge flambé fireball, the chef tosses the pasta high through the flames",
    plating: "pasta is twirled onto a plate with tongs, glossy sauce is spooned over it, parmesan snows down from a grater",
    bite: "a woman twirls a forkful of pasta and takes a bite, closes her eyes and smiles as her friend laughs",
  }],
  [/sushi|roll|sashimi|nigiri|omakase|poke/i, {
    food: "sushi",
    match: /sushi|sashimi|nigiri|salmon|tuna/,
    fire: "a blowtorch roars across glistening fish, the surface blisters and caramelizes, a razor-sharp knife slices through in one clean stroke",
    plating: "a sushi chef's precise hands press rice and fish and place each piece on a dark slate, a drop of sauce lands in slow motion",
    bite: "chopsticks dip a piece of sushi in soy sauce and a man eats it, pausing in amazement, then grinning at his friends",
  }],
  [/steak|beef|tagliata|ribeye|skewer|kebab|bbq|grill/i, {
    food: "steak",
    match: /steak|beef|meat|grill|bbq|barbecue|skewer|kebab/,
    fire: "meat drops onto a blazing grill and flames erupt around it, fat drips and flares, sparks fly into the dark",
    plating: "the meat is sliced to reveal a juicy pink center, butter and herbs are spooned over it, flaky salt falls in slow motion",
    bite: "a fork lifts a juicy piece of meat and a man takes a bite, closes his eyes and leans back satisfied",
  }],
  [/chicken|wing|tender|bites|fried|crispy/i, {
    food: "fried chicken",
    match: /chicken|fried|frying|wing/,
    fire: "pieces plunge into bubbling hot oil in an eruption of bubbles and spray, turning golden and crackling",
    plating: "golden pieces are tossed through glossy sauce in a steel bowl, sauce flying in slow motion, sesame seeds rain down",
    bite: "a woman bites into a crispy golden piece with an audible crunch, sauce on her fingers, laughing with friends",
  }],
  [/salmon|\bfish\b|\bcod\b|halibut|trout|sea bass|branzino|snapper|tuna steak/i, {
    food: "fish",
    match: /fish|salmon|trout|cod\b|seabass|sea bass/,
    stock: {
      fire: ["searing salmon in pan", "cooking fish in pan", "grilling fish"],
      plating: ["plating salmon", "plating fish dish", "salmon dish"],
      bite: ["eating salmon", "people eating fish", "eating fish dinner"],
    },
    fire: "a fillet is laid skin-down into a smoking pan of oil with a violent sizzle, butter foams and is basted over it, the skin crisps golden",
    plating: "the fillet is lifted onto the plate, lemon butter sauce is spooned over it in slow motion, herbs and flaky salt fall",
    bite: "a fork flakes off a tender piece of fish and a woman tastes it, her eyes widen and she smiles",
  }],
  [/shrimp|prawn|lobster|crab|fish|salmon|seafood/i, {
    food: "seafood",
    match: /shrimp|prawn|lobster|crab|fish|salmon|seafood|mussel|scallop/,
    fire: "seafood hits a smoking pan of garlic butter with a violent sizzle, the pan bursts into flame",
    plating: "seafood is arranged on the plate, garlic butter is poured over in slow motion, a lemon is squeezed and parsley scattered",
    bite: "a fork lifts a glistening piece of seafood and a woman tastes it, her eyes widen and she smiles",
  }],
  [/salad|bowl|grain|greens/i, {
    food: "salad",
    match: /salad|vegetable|veggie|greens|bowl/,
    fire: "vegetables and grains are charred in a flaming pan, a knife slices crisp vegetables at blinding speed, droplets of water fly",
    plating: "fresh colorful ingredients are arranged in a bowl, dressing is drizzled in a slow-motion ribbon, seeds are sprinkled",
    bite: "a woman takes a forkful from the bowl and eats with a relaxed happy smile, sunlight catching the table",
  }],
  [/donut|cake|torta|tart|pie|dessert|cookie|brownie|ice cream|cheesecake|crepe/i, {
    food: "dessert",
    match: /cake|dessert|chocolate|pastr|cream|sweet|cookie|donut|doughnut|pie|tart|brownie|waffle/,
    fire: "a blowtorch caramelizes sugar into a bubbling amber crust, molten chocolate pours in a slow-motion ribbon",
    plating: "glossy glaze cascades down the dessert in slow motion, powdered sugar drifts down like snow, a berry drops into place",
    bite: "a spoon breaks into the dessert and a woman takes a bite, eyes closed in bliss, her friend reaching in for more",
  }],
  [/curry|stew|soup|chili/i, {
    food: "curry",
    match: /curry|stew|soup|spice|pot/,
    fire: "spices hit hot oil and explode in a sizzling burst, flames lick the side of a heavy pot, the sauce churns and bubbles",
    plating: "the rich sauce is ladled into a bowl in slow motion, steam billows, fresh herbs and a swirl of cream are added",
    bite: "a spoonful is lifted, steaming, and a man tastes it and smiles warmly, nodding at his friends",
  }],
];
const DEFAULT_ACTIONS: DishActions = {
  food: "food",
  match: /food|cook|dish|meal|kitchen|chef/,
  fire: "ingredients hit a scorching pan in a violent sizzle and a burst of flame, the chef tosses them high through the fire",
  plating: "the dish is plated with precise hands, sauce drizzled in a slow-motion ribbon, garnish placed with tweezers",
  bite: "a fork lifts a bite and a woman tastes it, closes her eyes in delight, her friends laughing around her",
};

const oneLine = (s: string) => s.replace(/\s+/g, " ").trim().replace(/[.!?]+$/, "");

function actionsFor(title: string, description: string): DishActions {
  // The name decides first ("Garlic Shrimp Linguine" is pasta, not seafood); the description is a fallback.
  const match = (text: string) => ACTIONS.find(([re]) => re.test(text))?.[1];
  return match(title) ?? match(description) ?? DEFAULT_ACTIONS;
}

export function settingFor(title: string, description: string): Setting {
  return actionsFor(title, description).setting ?? "kitchen";
}

/** The setting most of the menu shares (a café menu of lattes and croissants opens on a barista, not a grill). */
export function menuSetting(dishes: { title: string; description: string }[]): Setting {
  const counts = new Map<Setting, number>();
  for (const d of dishes) {
    const s = settingFor(d.title, d.description);
    counts.set(s, (counts.get(s) ?? 0) + 1);
  }
  const [top] = [...counts].sort((a, b) => b[1] - a[1] || (a[0] === "kitchen" ? -1 : 1));
  return top?.[0] ?? "kitchen";
}

const HANDS: Record<Setting, string> = { kitchen: "Chef's", cafe: "Barista's", bar: "Bartender's" };

const dishLabel = (title: string, description: string) => {
  const desc = oneLine(description).slice(0, 140);
  return `${title}${desc ? ` (${desc})` : ""}`;
};

export function firePrompt(title: string, description: string): string {
  const a = actionsFor(title, description);
  return `Making ${dishLabel(title, description)}: ${a.fire}. ${HANDS[a.setting ?? "kitchen"]} hands and arms only, face out of frame. ${DRAMA}. ${CLEAN}`;
}

export function platingPrompt(title: string, description: string): string {
  const a = actionsFor(title, description);
  return `Finishing ${dishLabel(title, description)}: ${a.plating}. ${HANDS[a.setting ?? "kitchen"]} hands only, face out of frame. ${DRAMA}. ${CLEAN}`;
}

export function bitePrompt(title: string, description: string, restaurant: string): string {
  const place = { kitchen: "a cozy, busy restaurant", cafe: "a bright, cozy cafe", bar: "a lively, warmly lit bar" }[settingFor(title, description)];
  return `At a table in ${restaurant ? `${restaurant}, ` : ""}${place}, friends sharing ${dishLabel(title, description)}: ${actionsFor(title, description).bite}. Close-up. ${PEOPLE} ${WARM}. ${CLEAN}`;
}

export function kitchenPrompt(setting: Setting = "kitchen"): string {
  switch (setting) {
    case "cafe":
      return `Morning rush in a specialty coffee shop: a barista pulls espresso shots, steam wand hisses, milk is poured into latte art, cups line up on the counter in warm window light. Faces out of focus. ${WARM}. ${CLEAN}`;
    case "bar":
      return `A busy cocktail bar at night: a bartender shakes and strains drinks, pours from bottles in a long arc, glasses line the bar under warm pendant lights. Faces out of focus. ${WARM}. ${CLEAN}`;
    default:
      return `A restaurant kitchen in the heat of dinner service: a pan bursts into a tall column of fire, sparks fly, cooks move fast through drifting steam and smoke, plates slam down on the pass under heat lamps. Faces out of focus. ${DRAMA}. ${CLEAN}`;
  }
}

export function cheersPrompt(restaurant: string, setting: Setting = "kitchen"): string {
  const where = restaurant ? `${restaurant}, ` : "";
  switch (setting) {
    case "cafe":
      return `A sunny afternoon in ${where}a cozy cafe: friends around a small table clink coffee cups and laugh together over pastries. ${PEOPLE} ${WARM}. ${CLEAN}`;
    case "bar":
      return `Night in ${where}a lively bar: a group of friends raise their glasses in a toast, laughing together. ${PEOPLE} ${WARM}. ${CLEAN}`;
    default:
      return `Evening in ${where}a warm, busy restaurant: a table of friends raise their glasses in a toast over a spread of plates, laughing together. ${PEOPLE} ${WARM}. ${CLEAN}`;
  }
}

export function servingPrompt(restaurant: string, setting: Setting = "kitchen"): string {
  const subject = setting === "cafe" ? "coffee and pastries" : setting === "bar" ? "drinks and small plates" : "freshly prepared plates of food";
  return `At ${restaurant || "a welcoming neighborhood restaurant"}, a friendly waiter in an apron brings ${subject} to a table, carefully sets them down in front of smiling guests and welcomes them. Medium shot that clearly shows the server and seated diners. ${PEOPLE} ${WARM}. ${CLEAN}`;
}

export function socializingPrompt(restaurant: string, setting: Setting = "kitchen"): string {
  const place = setting === "cafe" ? "cafe over coffee and pastries" : setting === "bar" ? "bar over drinks and small plates" : "restaurant over a shared meal";
  return `Friends socializing at ${restaurant ? `${restaurant}, a ` : "a "}${place}, chatting, laughing, listening and passing a plate around the table. Candid medium wide shot showing the group. ${PEOPLE} ${WARM}. ${CLEAN}`;
}

/**
 * A stock footage search, plus patterns the clip's title must all match. Pexels search
 * is loose ("seafood cooking" returns a fish market), so results that don't mention
 * the subject (and, for cooking and eating shots, the action) are skipped.
 */
export interface StockQuery {
  query: string;
  match: RegExp[];
}

const COOKING = /cook|pan|fry|frying|stove|chef|grill|sizzl|saut|skillet|wok|flame|fire|oven|bak|sear|boil|kitchen/;
const PLATING = /plat|serv|garnish|dish|sauce|chef|food/;
const EATING = /eat|dining|dinner|lunch|meal|brunch|restaurant|food/;
const BREWING = /coffee|barista|espresso|latte|brew|grind|bean|froth/;
const COFFEE_TIME = /coffee|cafe|latte|cappuccino|espresso|mug/;
const BAR = /bar|cocktail|drink|beer|wine|toast|cheers|pour/;
const DINERS = /eat|dining|dinner|lunch|bite|tast|enjoy/;
const PEOPLE_MATCH = /people|person|friends|couple|family|group|woman|women|man|men|guest|customer|diner/;
const SERVICE = /waiter|waitress|server|serving|bringing|delivering/;

/** Always-available footage for each setting, after the dish-specific searches. */
const GENERIC: Record<Setting, Record<"fire" | "plating" | "bite" | "kitchen" | "cheers", StockQuery[]>> = {
  kitchen: {
    fire: [{ query: "cooking in a pan", match: [COOKING] }, { query: "chef cooking", match: [COOKING] }],
    plating: [{ query: "chef plating food", match: [PLATING] }, { query: "serving food", match: [PLATING] }],
    bite: [{ query: "people eating together", match: [EATING] }, { query: "friends eating dinner", match: [EATING] }],
    kitchen: [{ query: "chef cooking in a pan", match: [COOKING] }, { query: "cooking in a pan", match: [COOKING] }, { query: "busy restaurant kitchen", match: [COOKING] }],
    cheers: [{ query: "people eating together", match: [EATING] }, { query: "friends dinner table", match: [EATING] }, { query: "friends toast dinner", match: [/toast|cheers|dinner/] }],
  },
  cafe: {
    fire: [{ query: "barista making coffee", match: [BREWING] }, { query: "coffee brewing", match: [BREWING] }],
    plating: [{ query: "latte art", match: [/latte|coffee|milk|pour/] }, { query: "barista serving coffee", match: [BREWING] }],
    bite: [{ query: "people drinking coffee together", match: [COFFEE_TIME] }, { query: "woman drinking coffee", match: [COFFEE_TIME] }],
    kitchen: [{ query: "barista making coffee", match: [BREWING] }, { query: "espresso machine", match: [BREWING] }, { query: "coffee shop", match: [/coffee|cafe|barista/] }],
    cheers: [{ query: "friends drinking coffee together", match: [COFFEE_TIME] }, { query: "people in coffee shop", match: [/coffee|cafe/] }, { query: "friends cafe", match: [/cafe|coffee/] }],
  },
  bar: {
    fire: [{ query: "bartender making drinks", match: [BAR] }],
    plating: [{ query: "pouring drinks bar", match: [BAR] }],
    bite: [{ query: "friends drinking bar", match: [BAR] }],
    kitchen: [{ query: "bartender making cocktail", match: [BAR] }, { query: "bar pouring drinks", match: [BAR] }],
    cheers: [{ query: "friends toasting drinks", match: [/toast|cheers|drink/] }, { query: "friends drinking bar", match: [BAR] }],
  },
};

/**
 * Stock footage searches for a shot, most specific first ("people eating pizza"),
 * then generic ones for the dish's setting ("cooking in a pan", "people drinking
 * coffee together"). The intro and end card use the menu's setting. Empty for the
 * hero shot, which must show the restaurant's own dish.
 */
export function stockQueries(kind: ShotKind, title = "", description = "", setting?: Setting): StockQuery[] {
  if (kind === "hero") return [];
  if (kind === "serving") {
    const subject = setting === "cafe" ? "coffee cafe" : setting === "bar" ? "drinks bar" : "food restaurant";
    return [
      { query: `waiter serving ${subject} guests`, match: [SERVICE, /food|plate|meal|dish|restaurant|coffee|drink|cafe|bar/] },
      { query: `waitress bringing ${subject} table`, match: [SERVICE] },
    ];
  }
  if (kind === "socializing") {
    const place = setting === "cafe" ? "cafe coffee" : setting === "bar" ? "bar drinks" : "restaurant dinner";
    return [
      { query: `friends laughing talking ${place}`, match: [PEOPLE_MATCH, /talk|laugh|chat|dining|dinner|meal|restaurant|coffee|cafe|bar|drink/] },
      { query: `people socializing ${place}`, match: [PEOPLE_MATCH] },
    ];
  }
  if (kind === "kitchen" || kind === "cheers") return GENERIC[setting ?? "kitchen"][kind];
  const a = actionsFor(title, description);
  const specific =
    a.stock?.[kind] ??
    {
      fire: [`${a.food} cooking`, `cooking ${a.food}`],
      plating: [`${a.food} plating`, `chef plating ${a.food}`, `serving ${a.food}`],
      bite: [`people eating ${a.food}`, `friends eating ${a.food}`, `eating ${a.food}`],
    }[kind];
  // Cafe and bar searches name the action already; a meal's cooking shot must also show cooking, its bite shot eating.
  const match = a.setting ? [a.match] : kind === "fire" ? [a.match, COOKING] : kind === "bite" ? [a.match, DINERS] : [a.match];
  const queries = [...specific.map((query) => ({ query, match })), ...GENERIC[a.setting ?? "kitchen"][kind]];
  // A food-only close-up is not an eating shot, even if the search returns it.
  return kind === "bite" ? queries.map((q) => ({ ...q, match: [...q.match, PEOPLE_MATCH] })) : queries;
}
