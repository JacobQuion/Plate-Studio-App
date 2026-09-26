import type { Dish } from "@/lib/types";

/**
 * Curated fallback menus. Used when a Google Maps / Yelp page can't be parsed
 * (Maps renders client-side and Yelp rate-limits aggressively), so the stage
 * demo never shows an empty grid. A menu is picked by cuisine keywords in the
 * restaurant name or URL.
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
  [/pizz|trattoria|italian|pasta|osteria/i, "pizza"],
  [/ramen|sushi|poke|thai|pho|asian|japan|korean|izakaya|noodle/i, "asian"],
  [/caff?e|coffee|espresso|bakery|roaster/i, "cafe"],
  [/burger|grill|diner|bbq|taco|wing|chicken|shack/i, "american"],
];

export function demoMenuFor(hint: string): Dish[] {
  const match = KEYWORDS.find(([re]) => re.test(hint));
  return MENUS[match ? match[1] : "default"];
}
