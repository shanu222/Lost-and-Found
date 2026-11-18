/** Browser geolocation as a promise (rejects if denied/unavailable). */
export function currentPosition(timeout = 10000): Promise<{ lat: number; lng: number }> {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) return reject(new Error('unavailable'));
    navigator.geolocation.getCurrentPosition(
      (p) => resolve({ lat: p.coords.latitude, lng: p.coords.longitude }),
      reject,
      { enableHighAccuracy: false, timeout, maximumAge: 300000 },
    );
  });
}
