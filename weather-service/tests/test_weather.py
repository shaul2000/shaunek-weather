import os
import time
import unittest
from contextlib import asynccontextmanager
from datetime import datetime, timedelta, timezone
from unittest.mock import patch

import httpx
from fastapi import HTTPException

from app import main


def current_payload(city: str) -> dict:
    return {
        "location": {
            "name": city,
            "region": "Test Region",
            "country": "Test Country",
            "lat": 51.5072,
            "lon": -0.1276,
            "tz_id": "Europe/London",
            "localtime": "2026-11-01 09:00",
        },
        "current": {
            "temp_c": 24.5,
            "feelslike_c": 26.0,
            "humidity": 70,
            "wind_kph": 12.0,
            "precip_mm": 0.1,
            "last_updated": "2026-11-01 08:45",
            "condition": {"text": "Partly cloudy"},
        },
    }


def forecast_payload(city: str = "London") -> dict:
    now_epoch = int(time.time())
    first_epoch = now_epoch // 3600 * 3600 + 3600
    hours_by_day: dict[str, list[dict]] = {}
    for offset in range(48):
        epoch = first_epoch + offset * 3600
        timestamp = datetime.fromtimestamp(epoch, timezone.utc)
        date = timestamp.strftime("%Y-%m-%d")
        hours_by_day.setdefault(date, []).append(
            {
                "time": timestamp.strftime("%Y-%m-%d %H:%M"),
                "time_epoch": epoch,
                "temp_c": 24.5 + offset / 10,
                "chance_of_rain": 10,
                "condition": {"text": "Partly cloudy"},
            }
        )

    start_date = datetime.fromtimestamp(first_epoch, timezone.utc).date()
    forecast_days = []
    for offset in range(3):
        date = (start_date + timedelta(days=offset)).isoformat()
        forecast_days.append(
            {
                "date": date,
                "day": {
                    "maxtemp_c": 29.0,
                    "mintemp_c": 20.0,
                    "daily_chance_of_rain": 30,
                    "condition": {"text": "Partly cloudy"},
                },
                "astro": {"sunrise": "06:10 AM", "sunset": "06:01 PM"},
                "hour": hours_by_day.get(date, []),
            }
        )

    location = current_payload(city)["location"]
    return {
        "location": location,
        "current": current_payload(city)["current"],
        "forecast": {"forecastday": forecast_days},
    }


class WeatherServiceTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        main.featured_cache.clear()
        self.cities_patch = patch.object(main, "FEATURED_CITIES", ("London", "Tokyo"))
        self.cities_patch.start()
        self.addCleanup(self.cities_patch.stop)

    async def test_startup_fails_fast_without_weatherapi_key(self):
        with patch.dict(os.environ, {}, clear=True):
            with self.assertRaisesRegex(RuntimeError, "WEATHERAPI_KEY"):
                async with main.lifespan(main.app):
                    self.fail("Startup should not succeed without the provider key")

    async def test_weather_endpoint_returns_required_contract(self):
        requests = []

        async def handler(request):
            requests.append(request)
            if request.url.path.endswith("/current.json"):
                return httpx.Response(200, json=current_payload("London"))
            return httpx.Response(200, json=forecast_payload())

        async with self.app_with_provider(handler) as client:
            response = await client.get("/weather?city=London")

        self.assertEqual(response.status_code, 200)
        body = response.json()
        self.assertEqual(set(body), {"place", "current", "hourly", "daily"})
        self.assertEqual(
            set(body["place"]),
            {"name", "admin1", "country", "lat", "lon", "timezone", "localtime"},
        )
        self.assertEqual(body["place"]["timezone"], "Europe/London")
        self.assertEqual(
            set(body["current"]),
            {
                "temperature_2m",
                "apparent_temperature",
                "relative_humidity_2m",
                "wind_speed_10m",
                "precipitation",
                "condition_text",
                "time",
            },
        )
        self.assertEqual(
            set(body["hourly"]),
            {
                "time",
                "time_epoch",
                "temperature_2m",
                "condition_text",
                "precipitation_probability",
            },
        )
        self.assertEqual(
            set(body["daily"]),
            {
                "time",
                "temperature_2m_max",
                "temperature_2m_min",
                "condition_text",
                "precipitation_probability",
                "sunrise",
                "sunset",
            },
        )
        self.assertEqual(len(body["hourly"]["time"]), 24)
        self.assertTrue(all(len(value) == 24 for value in body["hourly"].values()))
        self.assertTrue(all(len(value) == 3 for value in body["daily"].values()))
        self.assertTrue(all(len(value) == 5 for value in body["hourly"]["time"]))
        self.assertEqual(body["daily"]["sunrise"][0], "06:10")
        self.assertIsInstance(body["current"]["temperature_2m"], (int, float))
        self.assertEqual(requests[0].url.params["key"], "test-key")
        self.assertEqual(requests[1].url.params["q"], "51.5072,-0.1276")
        self.assertEqual(requests[1].url.params["days"], "3")

    async def test_weather_endpoint_rejects_invalid_provider_timezone(self):
        async def handler(request):
            if request.url.path.endswith("/current.json"):
                payload = current_payload("London")
                payload["location"]["tz_id"] = "Invalid/Timezone"
                return httpx.Response(200, json=payload)
            return httpx.Response(200, json=forecast_payload())

        async with self.app_with_provider(handler) as client:
            response = await client.get("/weather?city=London")

        self.assertEqual(response.status_code, 502)

    async def test_forecast_uses_searched_location_timezone(self):
        searched_location = {
            "name": "Tokyo",
            "admin1": "Tokyo",
            "country": "Japan",
            "lat": 35.6762,
            "lon": 139.6503,
            "timezone": "Asia/Tokyo",
            "localtime": "2026-11-02 06:00",
        }
        data = forecast_payload("Tokyo")
        data["location"]["tz_id"] = "Europe/London"

        result = main.normalize_forecast_response(data, searched_location)

        self.assertEqual(result["place"]["timezone"], "Asia/Tokyo")

    async def test_featured_endpoint_returns_contract_and_caches_successes(self):
        calls = 0

        async def handler(request):
            nonlocal calls
            calls += 1
            return httpx.Response(
                200,
                json=current_payload(request.url.params["q"]),
            )

        async with self.app_with_provider(handler) as client:
            first = await client.get("/featured")
            second = await client.get("/featured")

        self.assertEqual(first.status_code, 200)
        locations = first.json()["locations"]
        self.assertEqual(len(locations), 2)
        self.assertEqual(set(locations[0]), {"place", "current", "stale"})
        self.assertEqual(
            set(locations[0]["place"]),
            {"name", "admin1", "country", "lat", "lon", "timezone", "localtime"},
        )
        self.assertEqual(locations[0]["place"]["timezone"], "Europe/London")
        self.assertEqual(
            set(locations[0]["current"]),
            {
                "temperature_2m",
                "apparent_temperature",
                "relative_humidity_2m",
                "wind_speed_10m",
                "precipitation",
                "condition_text",
                "time",
            },
        )
        self.assertIsInstance(locations[0]["current"]["temperature_2m"], (int, float))
        self.assertFalse(locations[0]["stale"])
        self.assertEqual(second.status_code, 200)
        self.assertFalse(first.json()["has_more"])
        self.assertIsNone(first.json()["next_offset"])
        self.assertEqual(calls, 2)

    async def test_featured_endpoint_paginates_without_fetching_future_cities(self):
        cities = tuple(f"City {index}" for index in range(18))
        calls = []

        async def handler(request):
            city = request.url.params["q"]
            calls.append(city)
            return httpx.Response(200, json=current_payload(city))

        with patch.object(main, "FEATURED_CITIES", cities):
            async with self.app_with_provider(handler) as client:
                invalid = await client.get("/featured?offset=0&limit=9")
                first = await client.get("/featured?offset=0&limit=8")
                second = await client.get("/featured?offset=8&limit=8")
                third = await client.get("/featured?offset=16&limit=8")

        self.assertEqual(invalid.status_code, 422)
        self.assertEqual(first.status_code, 200)
        self.assertEqual([item["place"]["name"] for item in first.json()["locations"]], list(cities[:8]))
        self.assertTrue(first.json()["has_more"])
        self.assertEqual(first.json()["next_offset"], 8)
        self.assertEqual(second.status_code, 200)
        second_cities = [item["place"]["name"] for item in second.json()["locations"]]
        self.assertEqual(second_cities, list(cities[8:16]))
        self.assertTrue(set(cities[:8]).isdisjoint(second_cities))
        self.assertTrue(second.json()["has_more"])
        self.assertEqual(second.json()["next_offset"], 16)
        self.assertEqual(third.status_code, 200)
        third_cities = [item["place"]["name"] for item in third.json()["locations"]]
        self.assertEqual(third_cities, list(cities[16:]))
        self.assertTrue(set(cities[:16]).isdisjoint(third_cities))
        self.assertFalse(third.json()["has_more"])
        self.assertIsNone(third.json()["next_offset"])
        self.assertEqual(calls, list(cities))

    async def test_featured_endpoint_keeps_stale_values_and_returns_null_without_cache(self):
        calls = 0

        async def handler(request):
            nonlocal calls
            calls += 1
            if calls == 1:
                return httpx.Response(200, json=current_payload(request.url.params["q"]))
            return httpx.Response(
                403,
                json={"error": {"code": 2007, "message": "Quota exceeded"}},
            )

        async with self.app_with_provider(handler) as client:
            await client.get("/featured")
            with patch.object(main, "FEATURED_CACHE_SECONDS", 0):
                response = await client.get("/featured")

        locations = response.json()["locations"]
        self.assertTrue(locations[0]["stale"])
        self.assertIsNone(locations[1]["current"])
        self.assertFalse(locations[1]["stale"])

    async def test_upstream_city_and_credential_errors_are_distinct(self):
        error_responses = (
            (400, {"error": {"code": 1006}}, 404),
            (401, {"error": {"code": 2006}}, 503),
            (403, {"error": {"code": 2007}}, 503),
            (400, {"error": {"code": 1003}}, 502),
        )

        for upstream_status, payload, expected_status in error_responses:
            async def handler(_request, status=upstream_status, body=payload):
                return httpx.Response(status, json=body)

            async with httpx.AsyncClient(
                transport=httpx.MockTransport(handler),
                timeout=httpx.Timeout(10.0, connect=4.0),
            ) as client:
                with self.assertRaises(HTTPException) as raised:
                    await main.provider_json(
                        client,
                        "test-key",
                        "forecast.json",
                        {"q": "London"},
                    )
            self.assertEqual(raised.exception.status_code, expected_status)

    async def test_forecast_endpoint_never_uses_network(self):
        async def handler(_request):
            return httpx.Response(200, json=forecast_payload())

        async with httpx.AsyncClient(
            transport=httpx.MockTransport(handler),
            timeout=httpx.Timeout(10.0, connect=4.0),
        ) as client:
            result = await main.provider_json(
                client,
                "test-key",
                "forecast.json",
                {"q": "51.5072,-0.1276", "days": "3", "aqi": "no", "alerts": "no"},
            )
        self.assertIn("forecast", result)

    @asynccontextmanager
    async def app_with_provider(self, handler):
        with patch.dict(os.environ, {"WEATHERAPI_KEY": "test-key"}):
            with patch.object(main, "API_BASE", "https://provider.test/v1"):
                async with main.lifespan(main.app):
                    async with httpx.AsyncClient(
                        transport=httpx.MockTransport(handler),
                        timeout=httpx.Timeout(10.0, connect=4.0),
                    ) as provider_client:
                        main.app.state.http_client = provider_client
                        async with httpx.AsyncClient(
                            transport=httpx.ASGITransport(app=main.app),
                            base_url="http://weather.test",
                        ) as api_client:
                            yield api_client


if __name__ == "__main__":
    unittest.main()
