import React, { useState, useEffect, useMemo } from "react";
import {
  MapContainer,
  TileLayer,
  Marker,
  Polyline,
  Popup,
  useMapEvents,
} from "react-leaflet";
import axios from "axios";
import AsyncSelect from "react-select/async";
import Select from "react-select";
import "leaflet/dist/leaflet.css";
import L from "leaflet";

import {
  FaCar,
  FaBicycle,
  FaWalking,
  FaTrain,
  FaSyncAlt,
  FaMoon,
  FaSun,
  FaRoute,
} from "react-icons/fa";

import "./styles.css";

delete L.Icon.Default.prototype._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl:
    "https://unpkg.com/leaflet@1.7.1/dist/images/marker-icon-2x.png",
  iconUrl: "https://unpkg.com/leaflet@1.7.1/dist/images/marker-icon.png",
  shadowUrl: "https://unpkg.com/leaflet@1.7.1/dist/images/marker-shadow.png",
});

const ORS_API_KEY = "5b3ce3597851110001cf6248f8da35f329cd4bf29c6e4f3c3d7dd754";
const HERE_API_KEY = "R8NHLuROUP6jVxJoHH7iDMnMWxqZRWy8w-5ARR17qE0";

const hereTrafficTilesUrl = `https://{s}.traffic.maps.ls.hereapi.com/traffic/6.3/flowtile/relative/{z}/{x}/{y}/256/png8?apiKey=${HERE_API_KEY}`;
const HERE_TILE_SUBDOMAINS = ["1", "2", "3", "4"];

const debounce = (func, delay) => {
  let timeout;
  return (...args) => {
    clearTimeout(timeout);
    timeout = setTimeout(() => func(...args), delay);
  };
};

const ClickToSetMarker = ({ setPoint, label }) => {
  useMapEvents({
    click: async (e) => {
      const { lat, lng } = e.latlng;
      try {
        const res = await axios.get(
          "https://nominatim.openstreetmap.org/reverse",
          {
            params: {
              lat,
              lon: lng,
              format: "json",
            },
          }
        );
        setPoint({
          label: `${label}: ${res.data.display_name}`,
          value: { lat, lon: lng },
        });
      } catch {
        alert("Reverse geocoding failed.");
      }
    },
  });
  return null;
};

const getBoundsFromCoords = (coords) => {
  let minLat = 90,
    maxLat = -90,
    minLng = 180,
    maxLng = -180;
  coords.forEach(([lat, lng]) => {
    if (lat < minLat) minLat = lat;
    if (lat > maxLat) maxLat = lat;
    if (lng < minLng) minLng = lng;
    if (lng > maxLng) maxLng = lng;
  });
  return { minLat, maxLat, minLng, maxLng };
};

const modeOptions = [
  {
    value: "driving-car",
    label: (
      <>
        <FaCar style={{ marginRight: 6 }} /> Car
      </>
    ),
  },
  {
    value: "cycling-regular",
    label: (
      <>
        <FaBicycle style={{ marginRight: 6 }} /> Bicycle
      </>
    ),
  },
  {
    value: "foot-walking",
    label: (
      <>
        <FaWalking style={{ marginRight: 6 }} /> Walking
      </>
    ),
  },
  {
    value: "commute",
    label: (
      <>
        <FaTrain style={{ marginRight: 6 }} /> Transit
      </>
    ),
  },
];

const App = () => {
  const [fromOption, setFromOption] = useState(
    JSON.parse(localStorage.getItem("from")) || null
  );
  const [toOption, setToOption] = useState(
    JSON.parse(localStorage.getItem("to")) || null
  );
  const [mode, setMode] = useState("driving-car");
  const [routeCoords, setRouteCoords] = useState([]);
  const [routeSegments, setRouteSegments] = useState([]);
  const [travelTime, setTravelTime] = useState(null);
  const [distance, setDistance] = useState(null);
  const [loading, setLoading] = useState(false);
  const [darkMode, setDarkMode] = useState(false);
  const [congestionLevel, setCongestionLevel] = useState("Low");

  useEffect(() => {
    localStorage.setItem("from", JSON.stringify(fromOption));
    localStorage.setItem("to", JSON.stringify(toOption));
  }, [fromOption, toOption]);

  const debouncedLoadOptions = useMemo(() => {
    return debounce(async (inputValue, callback) => {
      if (!inputValue || inputValue.length < 3) {
        callback([]);
        return;
      }
      try {
        const res = await axios.get(
          "https://nominatim.openstreetmap.org/search",
          {
            params: {
              q: inputValue,
              format: "json",
              addressdetails: 1,
              limit: 4,
              countrycodes: "ph",
            },
          }
        );

        const options = res.data.map((place) => ({
          label: place.display_name,
          value: {
            lat: parseFloat(place.lat),
            lon: parseFloat(place.lon),
          },
        }));

        callback(options);
      } catch (error) {
        console.error("Search error:", error);
        callback([]);
      }
    }, 300);
  }, []);

  const fetchTrafficData = async (bbox) => {
    const url = `https://traffic.ls.hereapi.com/traffic/6.3/flow.json?bbox=${bbox.minLat},${bbox.minLng};${bbox.maxLat},${bbox.maxLng}&apiKey=${HERE_API_KEY}`;
    try {
      const res = await axios.get(url);
      return res.data;
    } catch (e) {
      console.warn("Failed to fetch HERE traffic flow data", e);
      return null;
    }
  };

  const adjustTravelTimeAndSegments = (coords, trafficData) => {
    if (!trafficData || !trafficData.RWS) {
      return {
        segments: coordsToSegments(coords, "blue"),
        adjustedTimeMultiplier: 1,
        congestionLevel: "Low",
      };
    }

    let congestionLevels = [];

    trafficData.RWS.forEach((roadway) => {
      roadway.RW.forEach((road) => {
        road.FIS.forEach((flowItem) => {
          flowItem.CF.forEach((conf) => {
            congestionLevels.push(conf.JamFactor);
          });
        });
      });
    });

    const avgJam =
      congestionLevels.reduce((acc, c) => acc + c, 0) /
      (congestionLevels.length || 1);

    let multiplier = 1;
    let color = "blue";
    let congestionLevel = "Low";

    if (avgJam >= 7) {
      multiplier = 1.5;
      color = "red";
      congestionLevel = "High";
    } else if (avgJam >= 4) {
      multiplier = 1.3;
      color = "orange";
      congestionLevel = "Medium";
    } else if (avgJam >= 2) {
      multiplier = 1.15;
      color = "#1E90FF"; // DodgerBlue for mild congestion
      congestionLevel = "Low-Medium";
    }

    return {
      segments: coordsToSegments(coords, color),
      adjustedTimeMultiplier: multiplier,
      congestionLevel,
    };
  };

  const coordsToSegments = (coords, color) => {
    let segments = [];
    for (let i = 0; i < coords.length - 1; i++) {
      segments.push({
        positions: [coords[i], coords[i + 1]],
        color,
      });
    }
    return segments;
  };

  function decodePolyline(encoded) {
    let coords = [];
    let index = 0,
      lat = 0,
      lng = 0;

    while (index < encoded.length) {
      let result = 1,
        shift = 0,
        b;
      do {
        b = encoded.charCodeAt(index++) - 63 - 1;
        result += b << shift;
        shift += 5;
      } while (b >= 0x1f);
      lat += result & 1 ? ~(result >> 1) : result >> 1;

      result = 1;
      shift = 0;
      do {
        b = encoded.charCodeAt(index++) - 63 - 1;
        result += b << shift;
        shift += 5;
      } while (b >= 0x1f);
      lng += result & 1 ? ~(result >> 1) : result >> 1;

      coords.push([lat * 1e-5, lng * 1e-5]);
    }
    return coords;
  }

  const fetchRoute = async () => {
    if (!fromOption || !toOption) {
      alert("Please select both origin and destination.");
      return;
    }

    setLoading(true);
    setRouteCoords([]);
    setRouteSegments([]);
    setTravelTime(null);
    setDistance(null);
    setCongestionLevel("Low");

    try {
      if (mode === "commute") {
        const originParam = `${fromOption.value.lat},${fromOption.value.lon}`;
        const destinationParam = `${toOption.value.lat},${toOption.value.lon}`;

        const res = await axios.get(
          "https://transit.router.hereapi.com/v8/routes",
          {
            params: {
              origin: originParam,
              destination: destinationParam,
              transportMode: "bus,tram,subway,train",
              return: "polyline,summary,actions,instructions",
              apiKey: HERE_API_KEY,
            },
          }
        );

        if (!res.data.routes || res.data.routes.length === 0) {
          alert("No transit routes found.");
          setLoading(false);
          return;
        }

        const route = res.data.routes[0];
        const polylineStr = route.sections
          .map((section) => section.polyline)
          .join("");

        const coords = decodePolyline(polylineStr);

        // Use distance and duration from summary (seconds)
        const dist = route.sections.reduce(
          (sum, sec) => sum + sec.summary.length,
          0
        );
        const time = route.sections.reduce(
          (sum, sec) => sum + sec.summary.duration,
          0
        );

        // No traffic data for transit mode, use default
        setRouteCoords(coords);
        setRouteSegments(coordsToSegments(coords, "blue"));
        setDistance(dist);
        setTravelTime(Math.ceil(time / 60));
        setCongestionLevel("Low");
      } else {
        // Driving, cycling, walking modes via OpenRouteService
        const params = {
          api_key: ORS_API_KEY,
          start: `${fromOption.value.lon},${fromOption.value.lat}`,
          end: `${toOption.value.lon},${toOption.value.lat}`,
        };

        const url = `https://api.openrouteservice.org/v2/directions/${mode}/geojson`;

        const res = await axios.post(
          url,
          {
            coordinates: [
              [params.start.split(",")[0], params.start.split(",")[1]],
              [params.end.split(",")[0], params.end.split(",")[1]],
            ],
          },
          {
            headers: {
              Authorization: ORS_API_KEY,
              "Content-Type": "application/json",
            },
          }
        );

        if (!res.data || !res.data.features.length) {
          alert("No route found.");
          setLoading(false);
          return;
        }

        const coords = res.data.features[0].geometry.coordinates.map(
          ([lng, lat]) => [lat, lng]
        );
        const dist = res.data.features[0].properties.summary.distance;
        const time = res.data.features[0].properties.summary.duration;

        // Calculate bounding box for traffic data
        const bounds = getBoundsFromCoords(coords);

        // Fetch traffic flow data for bbox (for driving mode only)
        let trafficData = null;
        if (mode === "driving-car") {
          trafficData = await fetchTrafficData(bounds);
        }

        const { segments, adjustedTimeMultiplier, congestionLevel } =
          adjustTravelTimeAndSegments(coords, trafficData);

        setRouteCoords(coords);
        setRouteSegments(segments);
        setDistance(dist);
        setTravelTime(Math.ceil((time / 60) * adjustedTimeMultiplier));
        setCongestionLevel(congestionLevel);
      }
    } catch (error) {
      console.error(error);
      alert("Failed to fetch route or traffic data.");
    } finally {
      setLoading(false);
    }
  };

  const center = useMemo(() => {
    if (fromOption) {
      return [fromOption.value.lat, fromOption.value.lon];
    }
    return [14.5995, 120.9842]; // Manila default
  }, [fromOption]);

  return (
    <div className={`app ${darkMode ? "dark" : ""}`}>
      <header>
        <h1>
          <FaRoute style={{ marginRight: 8 }} />
          Route Planner
        </h1>
        <button
          className="dark-toggle"
          onClick={() => setDarkMode((prev) => !prev)}
          title="Toggle Dark Mode"
        >
          {darkMode ? <FaSun /> : <FaMoon />}
        </button>
      </header>

      <main>
        <div className="inputs">
          <AsyncSelect
            className="react-select-container"
            classNamePrefix="react-select"
            placeholder="From"
            value={fromOption}
            onChange={setFromOption}
            loadOptions={debouncedLoadOptions}
            isClearable
          />

          {/* Swap Button */}
          <button
            className="btn-swap"
            onClick={() => {
              const temp = fromOption;
              setFromOption(toOption);
              setToOption(temp);
            }}
            title="Swap From and To"
            type="button"
          >
            <FaSyncAlt />
          </button>

          <AsyncSelect
            className="react-select-container"
            classNamePrefix="react-select"
            placeholder="To"
            value={toOption}
            onChange={setToOption}
            loadOptions={debouncedLoadOptions}
            isClearable
          />
          <Select
            className="react-select-container"
            classNamePrefix="react-select"
            options={modeOptions}
            value={modeOptions.find((o) => o.value === mode)}
            onChange={(opt) => setMode(opt.value)}
          />
          <button
            className="btn-primary"
            onClick={fetchRoute}
            disabled={loading}
            title="Calculate Route"
          >
            {loading ? <FaSyncAlt className="spin" /> : "Calculate"}
          </button>
        </div>

        <div className="map-wrapper">
          <MapContainer
            center={center}
            zoom={13}
            scrollWheelZoom
            style={{ height: 450, width: "100%" }}
          >
            <TileLayer
              url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
              attribution='&copy; <a href="http://osm.org/copyright">OpenStreetMap</a> contributors'
            />
            {/* HERE Traffic Tiles Overlay */}
            <TileLayer
              url={hereTrafficTilesUrl}
              subdomains={HERE_TILE_SUBDOMAINS}
              opacity={0.6}
            />

            {fromOption && (
              <Marker position={[fromOption.value.lat, fromOption.value.lon]}>
                <Popup>From: {fromOption.label}</Popup>
              </Marker>
            )}
            {toOption && (
              <Marker position={[toOption.value.lat, toOption.value.lon]}>
                <Popup>To: {toOption.label}</Popup>
              </Marker>
            )}

            {/* Polyline Route Segments */}
            {routeSegments.map((seg, idx) => (
              <Polyline
                key={idx}
                positions={seg.positions}
                pathOptions={{ color: seg.color, weight: 6, opacity: 0.8 }}
              />
            ))}

            <ClickToSetMarker setPoint={setFromOption} label="From" />
            <ClickToSetMarker setPoint={setToOption} label="To" />
          </MapContainer>

          {/* Traffic Legend */}
          <div className="legend">
            <div className="item">
              <div className="color-box low"></div> Low Traffic
            </div>
            <div className="item">
              <div className="color-box low-medium"></div> Low-Medium Traffic
            </div>
            <div className="item">
              <div className="color-box medium"></div> Medium Traffic
            </div>
            <div className="item">
              <div className="color-box high"></div> High Traffic
            </div>
          </div>
        </div>

        {/* Results Card */}
        {distance !== null && travelTime !== null && (
          <div className="results-card" role="region" aria-live="polite">
            <h2>Route Summary</h2>
            <p>
              <strong>Distance:</strong> {(distance / 1000).toFixed(2)} km
            </p>
            <p>
              <strong>Estimated Travel Time:</strong> {travelTime} mins
            </p>
            <p>
              <strong>Traffic Level:</strong>{" "}
              <span className={`badge ${congestionLevel.toLowerCase()}`}>
                {congestionLevel}
              </span>
            </p>
          </div>
        )}
      </main>
      <footer>
        <small>
          Powered by OpenRouteService & HERE Traffic API | © 2025 Wren Macayan
        </small>
      </footer>
    </div>
  );
};

export default App;
