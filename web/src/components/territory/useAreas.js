import { useEffect, useState } from 'react';

const AREAS = `${import.meta.env.BASE_URL}territory/areas.json`;

// The land each place owns and the eleven region outlines, as SVG paths,
// generated once from the map image (see docs/territory-rules.md, "The map").
// Fetched rather than imported so the 65 KB stays out of the app bundle for
// the modes that never draw it. Shared by Territory and Region Bingo, so it is
// fetched once whichever map opens first.
let areasRequest;
export default function useAreas() {
  const [areas, setAreas] = useState(null);
  useEffect(() => {
    let live = true;
    areasRequest ??= fetch(AREAS).then((r) => (r.ok ? r.json() : null)).catch(() => null);
    areasRequest.then((a) => { if (live) setAreas(a); });
    return () => { live = false; };
  }, []);
  return areas;
}
