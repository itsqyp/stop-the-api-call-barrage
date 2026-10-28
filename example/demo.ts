import { OpenMeteoClient } from "../src/index.js";

let requests = 0;
const client = new OpenMeteoClient({
  fetchFn: (url) => {
    requests++;
    console.log("HTTP request:", url);
    return fetch(url);
  },
});

type Weather = { current?: { temperature_2m?: number } };

const cities = [
  ["Dhaka", 23.81, 90.41],
  ["Berlin", 52.52, 13.41],
  ["Paris", 48.85, 2.35],
] as const;

// 4 calls fired together: 3 cities + 1 duplicate of Berlin
const results = await Promise.all([
  ...cities.map(([, lat, lon]) => client.getWeather<Weather>(lat, lon)),
  client.getWeather<Weather>(52.52, 13.41),
]);

cities.forEach(([name], i) => {
  console.log(name, results[i]?.current?.temperature_2m, "°C");
});
console.log("Total HTTP requests:", requests);
