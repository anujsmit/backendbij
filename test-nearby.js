// Quick test script to call the getNearbyMistris API
const testLocation = {
    // Location close to the mistri (26.639885,87.991430)
    lat: 26.640,
    lng: 87.991,
    maxDistanceKm: 20
};

console.log('Testing getNearbyMistris API...');
console.log('Search location:', testLocation);
console.log('\nYou need to run this with a valid JWT token.');
console.log('Example curl command:');
console.log(`
curl -X POST http://localhost:3000/api/mistri/nearby \\
  -H "Content-Type: application/json" \\
  -H "Authorization: Bearer YOUR_TOKEN_HERE" \\
  -d '${JSON.stringify(testLocation)}'
`);
