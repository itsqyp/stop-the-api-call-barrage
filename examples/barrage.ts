const base = process.env.BASE_URL ?? "http://localhost:3000";
const spots = [
  [23.81, 90.41],
  [52.52, 13.41],
  [48.85, 2.35],
  [40.71, -74.01],
  [35.68, 139.69],
] as const;
//Massive Barrage of api calls
const calls = Array.from({ length: 50 }, (_, i) => {
  const [lat, lon] = spots[i % spots.length]!;
  return fetch(`${base}/weather?lat=${lat}&lon=${lon}`).then((r) => r.status);
});

const statuses = await Promise.all(calls);
console.log("responses:", statuses.length);
console.log(
  "all 200:",
  statuses.every((s) => s === 200),
);
