import type { Dish } from "@/lib/types";

/**
 * Curated fallback menus. Used when a Google Maps / Yelp page can't be parsed
 * (Maps renders client-side and Yelp rate-limits aggressively), so the stage
 * demo never shows an empty grid. A menu is picked by cuisine keywords in the
 * restaurant name or URL.
 *
 * DEMO_RESTAURANTS are ready-made sample projects the studio can load in one click.
 */

const img = (id: string) => `https://images.unsplash.com/photo-${id}?w=1600&q=80&auto=format&fit=crop`;

const MENUS: Record<string, Dish[]> = {
  pizza: [
    { id: "pz-1", title: "BBQ Chicken Pizza", price: "$18.50", description: "Smoky BBQ chicken, pineapple, red onion and cilantro on a wood-fired crust.", imageUrl: img("1565299624946-b28f40a0ae38") },
    { id: "pz-2", title: "Garlic Shrimp Linguine", price: "$21.00", description: "Tiger prawns, cherry tomatoes, chili and garlic butter over fresh linguine.", imageUrl: img("1563379926898-05f4575a45d8") },
    { id: "pz-3", title: "Tagliata di Manzo", price: "$27.00", description: "Seared sliced steak, peppery greens and a rich pan jus.", imageUrl: img("1504674900247-0877df9cc836") },
    { id: "pz-4", title: "Raspberry Cream Torta", price: "$9.50", description: "Layers of sponge, whipped mascarpone and fresh raspberries.", imageUrl: img("1565958011703-44f9829ba187") },
  ],
  asian: [
    { id: "as-1", title: "Spicy Shrimp Ramen", price: "$16.50", description: "Rich miso broth, tiger prawns, jammy egg and snap peas.", imageUrl: img("1569718212165-3a8278d5f624") },
    { id: "as-2", title: "Salmon Poke Bowl", price: "$15.00", description: "Sushi-grade salmon, avocado, edamame and spicy mayo over rice.", imageUrl: img("1546069901-ba9599a7e63c") },
    { id: "as-3", title: "Sizzling Beef Skewers", price: "$13.00", description: "Charcoal-grilled beef glazed with sweet soy and sesame.", imageUrl: img("1555939594-58d7cb561ad1") },
    { id: "as-4", title: "Chef's Omakase Roll", price: "$19.00", description: "Eight pieces of the chef's daily selection, torched and glazed.", imageUrl: img("1579871494447-9811cf80d66c") },
  ],
  american: [
    { id: "am-1", title: "Smash Double Cheeseburger", price: "$14.99", description: "Two crispy-edged patties, American cheese and house sauce on brioche.", imageUrl: img("1568901346375-23c9450c58cd") },
    { id: "am-2", title: "Loaded Street Tacos", price: "$12.50", description: "Charred carne asada, pickled onion, cilantro and lime crema.", imageUrl: img("1551504734-5ee1c4a1479b") },
    { id: "am-3", title: "Crispy Chicken Bites", price: "$11.00", description: "Buttermilk-brined chicken, hot honey drizzle and ranch.", imageUrl: img("1562967914-608f82629710") },
    { id: "am-4", title: "Glazed Donut Stack", price: "$8.50", description: "Chocolate-glazed brioche donuts piled high with rainbow sprinkles.", imageUrl: img("1551024601-bec78aea704b") },
  ],
  italian: [
    { id: "it-1", title: "Spaghetti Carbonara", price: "$19.00", description: "Guanciale, egg yolk, pecorino romano and cracked black pepper, tossed to order.", imageUrl: img("1612874742237-6526221588e3") },
    { id: "it-2", title: "Spaghetti alle Vongole", price: "$24.00", description: "Littleneck clams, white wine, garlic, chili and parsley.", imageUrl: img("1595295333158-4742f28fbd85") },
    { id: "it-3", title: "Nonna's Sunday Ragù", price: "$22.00", description: "Spaghetti in a beef ragù slow-simmered for eight hours.", imageUrl: img("1551183053-bf91a1d81141") },
    { id: "it-4", title: "Penne all'Arrabbiata", price: "$17.00", description: "San Marzano tomatoes, garlic and Calabrian chili with fresh basil.", imageUrl: img("1621996346565-e3dbc646d9a9") },
    { id: "it-5", title: "Classic Tiramisu", price: "$10.00", description: "Espresso-soaked ladyfingers, whipped mascarpone and cocoa.", imageUrl: img("1571877227200-a0d98ea607e9") },
  ],
  // Imported from yelp.com/menu/the-cheesecake-factory-san-francisco-12, photos included.
  cheesecake: [
    { id: "cc-1", title: "Avocado Eggrolls", price: "$18.95", description: "Avocado, Sun-Dried Tomato, Red Onion and Cilantro Fried in a Crisp Wrapper. Served with a Tamarind-Cashew Dipping Sauce", imageUrl: "https://s3-media0.fl.yelpcdn.com/bphoto/rdTCSUQsR_EVBU9Tb2xgYA/o.jpg" },
    { id: "cc-2", title: "Chicken Madeira", price: "$29.95", description: "Our most popular chicken dish! Sauteed Chicken Breast Topped with Fresh Asparagus and Melted Mozzarella Cheese. Covered with Fresh Mushroom Madeira Sauce and Served with Mashed Potatoes", imageUrl: "https://s3-media0.fl.yelpcdn.com/bphoto/RclAY9BH5VMcVi3iT0e2OA/o.jpg" },
    { id: "cc-3", title: "Louisiana Chicken Pasta", price: "$29.95", description: "Parmesan Crusted Chicken Served Over Pasta with Mushrooms, Peppers and Onions in a Spicy New Orleans Sauce", imageUrl: "https://s3-media0.fl.yelpcdn.com/bphoto/RSXfD1tbGYPwzzghGZBwsg/o.jpg" },
    { id: "cc-4", title: "Fried Macaroni and Cheese", price: "$19.50", description: "Crispy Crumb Coated Macaroni and Cheese Balls. Served over a Creamy Marinara Sauce", imageUrl: "https://s3-media0.fl.yelpcdn.com/bphoto/Rro1t0qsTkpJZq8BTlXJfw/o.jpg" },
    { id: "cc-5", title: "Fresh Strawberry Cheesecake", price: "", description: "The Original Topped with Glazed Fresh Strawberries. Our Most Popular Flavor for over 45 Years!", imageUrl: "https://s3-media0.fl.yelpcdn.com/bphoto/DYiHWLa15aJ9zJHfAgC8CQ/o.jpg" },
  ],
  mexican: [
    { id: "mx-1", title: "Tacos al Pastor", price: "$13.50", description: "Spit-roasted adobo pork, grilled pineapple, onion and cilantro on corn tortillas.", imageUrl: img("1613514785940-daed07799d9b") },
    { id: "mx-2", title: "Carne Asada Tacos", price: "$14.00", description: "Mesquite-grilled steak, fresh cilantro, white onion and salsa verde.", imageUrl: img("1599974579688-8dbdd335c77f") },
    { id: "mx-3", title: "Baja Fish Tacos", price: "$14.50", description: "Beer-battered fish, avocado, pico de gallo and chipotle crema.", imageUrl: img("1565299585323-38d6b0865b47") },
    { id: "mx-4", title: "Quesadilla Estrada", price: "$12.00", description: "Oaxaca cheese and chicken tinga pressed in a crisp flour tortilla.", imageUrl: img("1618040996337-56904b7850b9") },
    { id: "mx-5", title: "Burrito de la Casa", price: "$15.00", description: "Grilled chicken, rice, black beans, slaw and salsa roja, wrapped to go.", imageUrl: img("1626700051175-6818013e1d4f") },
  ],
  ramen: [
    { id: "rm-1", title: "Tonkotsu Ramen", price: "$17.00", description: "Eighteen-hour pork bone broth, chashu, ajitama egg and nori.", imageUrl: img("1557872943-16a5ac26437e") },
    { id: "rm-2", title: "Spicy Miso Ramen", price: "$17.50", description: "Red miso broth with chili oil, roast pork and scallions.", imageUrl: img("1617093727343-374698b1b08d") },
    { id: "rm-3", title: "Tantanmen", price: "$16.50", description: "Sesame broth, spicy ground pork, bok choy and a soft-boiled egg.", imageUrl: img("1591814468924-caf88d1232e1") },
    { id: "rm-4", title: "Pan-Fried Gyoza", price: "$9.00", description: "Crisp-bottomed pork and cabbage dumplings with ponzu.", imageUrl: img("1534422298391-e4f8c172dddb") },
  ],
  burger: [
    { id: "bg-1", title: "The Big Stack", price: "$8.99", description: "Flame-grilled beef, melted cheddar, lettuce, tomato and stack sauce on a toasted bun.", imageUrl: img("1571091718767-18b5b1457add") },
    { id: "bg-2", title: "Bacon Cheeseburger", price: "$9.99", description: "Crispy bacon, double cheese and pickles on a sesame bun.", imageUrl: img("1586190848861-99aa4a171e90") },
    { id: "bg-3", title: "Crispy Chicken Sandwich", price: "$8.49", description: "Buttermilk fried chicken, slaw and spicy mayo on brioche.", imageUrl: img("1606755962773-d324e0a13086") },
    { id: "bg-4", title: "Golden Fries", price: "$3.49", description: "Hand-cut, twice-fried and salted the second they're out.", imageUrl: img("1630384060421-cb20d0e0649d") },
    { id: "bg-5", title: "Cookies & Cream Shake", price: "$5.49", description: "Hand-spun vanilla soft serve blended with chocolate cookies.", imageUrl: img("1572490122747-3968b75cc699") },
  ],
  cafe: [
    { id: "cf-1", title: "Iced Latte", price: "$5.75", description: "Double espresso poured over ice and cold whole milk.", imageUrl: img("1461023058943-07fcbe16d735") },
    { id: "cf-2", title: "House Cappuccino", price: "$4.95", description: "Rich espresso under silky steamed milk and rosetta latte art.", imageUrl: img("1572442388796-11668a67e53d") },
    { id: "cf-3", title: "Butter Croissant", price: "$4.25", description: "Flaky, golden layers baked fresh every morning.", imageUrl: img("1555507036-ab1f4038808a") },
    { id: "cf-4", title: "Chocolate Fudge Cake", price: "$6.50", description: "Dark chocolate layers, ganache drip and piped mocha buttercream.", imageUrl: img("1578985545062-69928b1d9587") },
  ],
  default: [
    { id: "df-1", title: "Harvest Grain Bowl", price: "$15.50", description: "Roasted veggies, quinoa, avocado and lemon tahini.", imageUrl: img("1512621776951-a57141f2eefd") },
    { id: "df-2", title: "Smash Double Cheeseburger", price: "$14.99", description: "Two crispy-edged patties, American cheese and house sauce on brioche.", imageUrl: img("1568901346375-23c9450c58cd") },
    { id: "df-3", title: "BBQ Chicken Pizza", price: "$18.50", description: "Smoky BBQ chicken, pineapple, red onion and cilantro on a wood-fired crust.", imageUrl: img("1565299624946-b28f40a0ae38") },
    { id: "df-4", title: "Spicy Shrimp Ramen", price: "$16.50", description: "Rich miso broth, tiger prawns, jammy egg and snap peas.", imageUrl: img("1569718212165-3a8278d5f624") },
    { id: "df-5", title: "Garden Salad", price: "$11.00", description: "Crisp greens, shaved radish, citrus and herb vinaigrette.", imageUrl: img("1540189549336-e6e99c3679fe") },
    { id: "df-6", title: "Glazed Donut Stack", price: "$8.50", description: "Chocolate-glazed brioche donuts piled high with rainbow sprinkles.", imageUrl: img("1551024601-bec78aea704b") },
  ],
};

const KEYWORDS: [RegExp, keyof typeof MENUS][] = [
  [/pizz/i, "pizza"],
  [/spaghett|pasta|trattoria|italian|osteria|nonna/i, "italian"],
  [/taco|taqueria|mexican|cantina|hacienda|burrito|estrada/i, "mexican"],
  [/ramen|izakaya|noodle/i, "ramen"],
  [/sushi|poke|thai|pho|asian|japan|korean/i, "asian"],
  [/caff?e|coffee|espresso|bakery|roaster/i, "cafe"],
  [/burger|fries|shake|drive.?in/i, "burger"],
  [/grill|diner|bbq|wing|chicken|shack/i, "american"],
];

export function demoMenuFor(hint: string): Dish[] {
  const match = KEYWORDS.find(([re]) => re.test(hint));
  return MENUS[match ? match[1] : "default"];
}

export interface DemoRestaurant {
  id: string;
  /** Short label for the sample button. */
  label: string;
  /** Kind of place, shown on the dashboard's template cards. */
  cuisine: string;
  name: string;
  website: string;
  cta: string;
  dishes: Dish[];
}

export const DEMO_RESTAURANTS: DemoRestaurant[] = [
  { id: "italian", label: "Cheesecake Factory", cuisine: "American comfort food & dessert", name: "The Cheesecake Factory", website: "thecheesecakefactory.com", cta: "Book a table", dishes: MENUS.cheesecake },
  { id: "mexican", label: "Hacienda Estrada", cuisine: "Mexican restaurant", name: "Hacienda Estrada", website: "haciendaestrada.com", cta: "Order now", dishes: MENUS.mexican },
  { id: "ramen", label: "Ramen bar", cuisine: "Japanese ramen bar", name: "Kumo Ramen Bar", website: "kumoramen.com", cta: "Walk in tonight", dishes: MENUS.ramen },
  { id: "burger", label: "Burger chain", cuisine: "Fast-food burger chain", name: "Big Stack Burgers", website: "bigstack.com", cta: "Order on the app", dishes: MENUS.burger },
];

/** The dashboard's examples: the samples plus a café with its menu built in (no live Yelp import). */
export const DEMOS: DemoRestaurant[] = [
  ...DEMO_RESTAURANTS,
  { id: "cafe", label: "Café", cuisine: "Berkeley café", name: "Caffe Strada", website: "caffestrada.com", cta: "Stop by today", dishes: MENUS.cafe },
];

/**
 * Each example is one shared project, "demo-<id>": rendered once, then every visit replays that
 * render. Demo projects aren't listed on the dashboard, and editing one saves a copy instead.
 */
export const DEMO_PREFIX = "demo-";
export const demoProjectId = (demoId: string) => `${DEMO_PREFIX}${demoId}`;
export const demoForProject = (projectId: string) => (projectId.startsWith(DEMO_PREFIX) ? DEMOS.find((d) => demoProjectId(d.id) === projectId) : undefined);

/** Demos featured on the dashboard; the rest still open by link. */
const FEATURED = ["italian", "ramen"];

/** Starting points offered on the dashboard. */
export const TEMPLATES: { id: string; name: string; cuisine: string; imageUrl: string; detail: string }[] = DEMOS.filter((d) => FEATURED.includes(d.id)).map((d) => ({
  id: d.id,
  name: d.name,
  cuisine: d.cuisine,
  imageUrl: d.id === "cafe" ? d.dishes[1].imageUrl : d.dishes[0].imageUrl,
  detail: `${d.dishes.length} dishes`,
}));
