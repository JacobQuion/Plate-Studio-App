export type LocationSource = "google" | "yelp" | "web" | "manual";

export interface RestaurantLocation {
  id: string;
  name: string;
  address: string;
  source: LocationSource;
  url: string;
  website?: string;
  sources?: { title: string; url: string }[];
}

export interface LocationSearchResult {
  locations: RestaurantLocation[];
  notice?: string;
  searchSuggestions?: string;
}

export const LOCATION_SOURCE: Record<LocationSource, string> = {
  google: "Google Maps", yelp: "Yelp", web: "Google Search", manual: "Added by you",
};

export function locationSearchLinks(query: string, city = "") {
  return {
    google: `https://www.google.com/maps/search/?${new URLSearchParams({ api: "1", query: `${query} ${city}`.trim() })}`,
    yelp: `https://www.yelp.com/search?${new URLSearchParams({ find_desc: city ? query : "restaurants", find_loc: city || query })}`,
  };
}
