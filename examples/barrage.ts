const base = process.env.BASE_URL ?? "http://localhost:3000";
const apiKey = process.env.API_KEY;
const headers: Record<string, string> = apiKey
  ? { Authorization: `Bearer ${apiKey}` }
  : {};

const spots = [
  [23.81, 90.41],
  [52.52, 13.41],
  [48.85, 2.35],
  [40.71, -74.01],
  [35.68, 139.69],
] as const;

const calls = Array.from({ length: 50 }, (_, i) => {
  const [lat, lon] = spots[i % spots.length]!;
  return fetch(`${base}/weather?lat=${lat}&lon=${lon}`, { headers }).then(
    (r) => r.status,
  );
});

const statuses = await Promise.all(calls);
const count = (s: number) => statuses.filter((x) => x === s).length;
console.log("responses:", statuses.length);
console.log(`200: ${count(200)}  401: ${count(401)}  429: ${count(429)}`);
