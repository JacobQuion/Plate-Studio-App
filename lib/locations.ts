export type LocationSource = "google" | "yelp" | "manual";

export interface RestaurantLocation {
  id: string;
  name: string;
  address: string;
  source: LocationSource;
  url: string;
  website?: string;
}

export interface LocationSearchResult {
  locations: RestaurantLocation[];
  notice?: string;
}

export const LOCATION_SOURCE: Record<LocationSource, string> = {
  google: "Google Maps", yelp: "Yelp", manual: "Added by you",
};

export function locationSearchLinks(query: string, city: string) {
  return {
    google: `https://www.google.com/maps/search/?${new URLSearchParams({ api: "1", query: `${query} ${city}`.trim() })}`,
    yelp: `https://www.yelp.com/search?${new URLSearchParams({ find_desc: query, find_loc: city })}`,
  };
}
