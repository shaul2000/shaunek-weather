import asyncio
import logging
import os
import re
import time
from contextlib import asynccontextmanager
from datetime import datetime
from pathlib import Path
from typing import Any
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

import httpx
from dotenv import load_dotenv
from fastapi import FastAPI, HTTPException, Query, Request
import hmac
from fastapi.responses import JSONResponse

load_dotenv(Path(__file__).resolve().parent.parent / ".env")

API_BASE = "https://api.weatherapi.com/v1"
FEATURED_CITIES = (
    "Abuja",
    "Lagos",
    "London",
    "New York",
    "Dubai",
    "Tokyo",
    "Singapore",
    "Sydney",
    "Paris",
    "Toronto",
    "Mumbai",
    "Seoul",
    "Cairo",
    "Rio de Janeiro",
    "Nairobi",
    "Auckland",
    "Madrid",
    "Berlin",
    "Rome",
    "Amsterdam",
    "Istanbul",
    "Bangkok",
    "Jakarta",
    "Manila",
    "Beijing",
    "Shanghai",
    "Hong Kong",
    "Taipei",
    "Kuala Lumpur",
    "Hanoi",
    "Dhaka",
    "Karachi",
    "Johannesburg",
    "Accra",
    "Addis Ababa",
    "Casablanca",
    "Cape Town",
    "Tunis",
    "Dar es Salaam",
    "Kampala",
    "Mexico City",
    "Los Angeles",
    "Chicago",
    "San Francisco",
    "Vancouver",
    "Montreal",
    "Buenos Aires",
    "Santiago",
    "Lima",
    "Bogota",
    "Sao Paulo",
    "Stockholm",
    "Oslo",
    "Copenhagen",
    "Warsaw",
)
FEATURED_PAGE_SIZE = 8
FEATURED_CACHE_SECONDS = 600
STALE_CACHE_SECONDS = 21600
logger = logging.getLogger(__name__)
featured_cache: dict[str, tuple[float, dict[str, Any]]] = {}
featured_refresh_lock = asyncio.Lock()
TIME_PATTERN = re.compile(r"^\d{2}:\d{2}$")


@asynccontextmanager
async def lifespan(app: FastAPI):
    api_key = os.environ.get("WEATHERAPI_KEY", "").strip()
    if not api_key:
        raise RuntimeError(
            "WEATHERAPI_KEY must be set in the weather-service environment"
        )

    app.state.weatherapi_key = api_key
    async with httpx.AsyncClient(
        timeout=httpx.Timeout(10.0, connect=4.0),
        follow_redirects=False,
    ) as client:
        app.state.http_client = client
        yield


app = FastAPI(
    title="Shaunek Weather Data Service",
    docs_url=None,
    redoc_url=None,
    lifespan=lifespan,
)

SERVICE_SECRET = os.environ.get("WEATHER_SERVICE_SECRET", "")

@app.middleware("http")
async def require_service_secret(request: Request, call_next):
    if request.url.path == "/health":
        return await call_next(request)
    if not SERVICE_SECRET:
        return JSONResponse({"error": "service misconfigured"}, status_code=500)
    supplied = request.headers.get("x-internal-secret", "")
    if not hmac.compare_digest(supplied, SERVICE_SECRET):
        return JSONResponse({"error": "unauthorized"}, status_code=401)
    return await call_next(request)

def _error_code(payload: Any) -> int | None:
    if not isinstance(payload, dict):
        return None
    error = payload.get("error")
    if not isinstance(error, dict):
        return None
    code = error.get("code")
    return code if isinstance(code, int) else None


async def provider_json(
    client: httpx.AsyncClient,
    api_key: str,
    endpoint: str,
    params: dict[str, str],
) -> Any:
    try:
        response = await client.get(
            f"{API_BASE}/{endpoint}",
            params={"key": api_key, **params},
        )
    except httpx.HTTPError:
        raise HTTPException(
            status_code=502,
            detail="Weather provider is temporarily unavailable",
        ) from None

    try:
        payload = response.json()
    except ValueError:
        payload = None

    code = _error_code(payload)
    if response.status_code in (401, 403) or code in (2006, 2007, 2008, 2009):
        raise HTTPException(
            status_code=503,
            detail="Weather provider rejected its API key or account access",
        )
    if code == 1006:
        raise HTTPException(status_code=404, detail="City not found")
    if response.status_code == 400:
        raise HTTPException(
            status_code=502,
            detail="Weather provider rejected the location request",
        )
    if response.status_code >= 400:
        raise HTTPException(
            status_code=502,
            detail="Weather provider is temporarily unavailable",
        )
    if not isinstance(payload, (dict, list)):
        raise HTTPException(
            status_code=502,
            detail="Weather provider returned an invalid response",
        )
    if code is not None:
        raise HTTPException(
            status_code=502,
            detail="Weather provider returned an invalid response",
        )
    return payload


def _require_dict(value: Any, message: str) -> dict[str, Any]:
    if not isinstance(value, dict):
        raise HTTPException(status_code=502, detail=message)
    return value


def _number(value: Any, message: str) -> int | float:
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        raise HTTPException(status_code=502, detail=message)
    return value


def _place(location: dict[str, Any]) -> dict[str, Any]:
    name = location.get("name")
    latitude = location.get("lat")
    longitude = location.get("lon")
    timezone = location.get("timezone") or location.get("tz_id")
    if not isinstance(name, str) or not name:
        raise HTTPException(
            status_code=502,
            detail="Weather provider returned an invalid location",
        )
    if not isinstance(timezone, str) or not timezone:
        raise HTTPException(
            status_code=502,
            detail="Weather provider returned an invalid location time zone",
        )
    try:
        ZoneInfo(timezone)
    except (ValueError, ZoneInfoNotFoundError):
        raise HTTPException(
            status_code=502,
            detail="Weather provider returned an invalid location time zone",
        ) from None

    return {
        "name": name,
        "admin1": location.get("region"),
        "country": location.get("country"),
        "lat": _number(latitude, "Weather provider returned an invalid location"),
        "lon": _number(longitude, "Weather provider returned an invalid location"),
        "timezone": timezone,
        "localtime": location.get("localtime"),
    }


def _current(current: dict[str, Any]) -> dict[str, Any]:
    condition = _require_dict(
        current.get("condition"),
        "Weather provider returned incomplete conditions",
    )
    text = condition.get("text")
    updated = current.get("last_updated")
    if not isinstance(text, str) or not isinstance(updated, str):
        raise HTTPException(
            status_code=502,
            detail="Weather provider returned incomplete conditions",
        )

    return {
        "temperature_2m": _number(
            current.get("temp_c"),
            "Weather provider returned incomplete conditions",
        ),
        "apparent_temperature": _number(
            current.get("feelslike_c"),
            "Weather provider returned incomplete conditions",
        ),
        "relative_humidity_2m": _number(
            current.get("humidity"),
            "Weather provider returned incomplete conditions",
        ),
        "wind_speed_10m": _number(
            current.get("wind_kph"),
            "Weather provider returned incomplete conditions",
        ),
        "precipitation": _number(
            current.get("precip_mm"),
            "Weather provider returned incomplete conditions",
        ),
        "condition_text": text,
        "time": updated,
    }


def _clock_time(value: Any) -> str:
    if not isinstance(value, str):
        raise HTTPException(
            status_code=502,
            detail="Weather provider returned an invalid forecast time",
        )
    if TIME_PATTERN.fullmatch(value):
        return value
    try:
        return datetime.strptime(value, "%I:%M %p").strftime("%H:%M")
    except ValueError:
        raise HTTPException(
            status_code=502,
            detail="Weather provider returned an invalid forecast time",
        ) from None


def _forecast_arrays(data: dict[str, Any]) -> tuple[dict[str, Any], dict[str, Any]]:
    forecast = _require_dict(
        data.get("forecast"),
        "Weather provider returned an incomplete forecast",
    )
    forecast_days = forecast.get("forecastday")
    if not isinstance(forecast_days, list) or not forecast_days:
        raise HTTPException(
            status_code=502,
            detail="Weather provider returned an incomplete forecast",
        )

    daily = {
        "time": [],
        "temperature_2m_max": [],
        "temperature_2m_min": [],
        "condition_text": [],
        "precipitation_probability": [],
        "sunrise": [],
        "sunset": [],
    }
    all_hours = []

    for day in forecast_days:
        day = _require_dict(day, "Weather provider returned an invalid forecast")
        details = _require_dict(
            day.get("day"),
            "Weather provider returned an incomplete forecast",
        )
        condition = _require_dict(
            details.get("condition"),
            "Weather provider returned an incomplete forecast",
        )
        astronomy = _require_dict(
            day.get("astro"),
            "Weather provider returned an incomplete forecast",
        )
        date = day.get("date")
        condition_text = condition.get("text")
        if not isinstance(date, str) or not isinstance(condition_text, str):
            raise HTTPException(
                status_code=502,
                detail="Weather provider returned an incomplete forecast",
            )

        daily["time"].append(date)
        daily["temperature_2m_max"].append(
            _number(details.get("maxtemp_c"), "Weather provider returned an incomplete forecast")
        )
        daily["temperature_2m_min"].append(
            _number(details.get("mintemp_c"), "Weather provider returned an incomplete forecast")
        )
        daily["condition_text"].append(condition_text)
        daily["precipitation_probability"].append(
            _number(
                details.get("daily_chance_of_rain"),
                "Weather provider returned an incomplete forecast",
            )
        )
        daily["sunrise"].append(_clock_time(astronomy.get("sunrise")))
        daily["sunset"].append(_clock_time(astronomy.get("sunset")))

        hours = day.get("hour")
        if not isinstance(hours, list):
            raise HTTPException(
                status_code=502,
                detail="Weather provider returned an incomplete hourly forecast",
            )
        all_hours.extend(hours)

    now = int(time.time())
    hourly = {
        "time": [],
        "time_epoch": [],
        "temperature_2m": [],
        "condition_text": [],
        "precipitation_probability": [],
    }
    for hour in sorted(
        (
            _require_dict(
                item,
                "Weather provider returned an invalid hourly forecast",
            )
            for item in all_hours
        ),
        key=lambda item: item.get("time_epoch", 0),
    ):
        epoch = hour.get("time_epoch")
        if isinstance(epoch, bool) or not isinstance(epoch, int):
            raise HTTPException(
                status_code=502,
                detail="Weather provider returned an invalid hourly forecast",
            )
        if epoch < now or epoch >= now + 24 * 60 * 60:
            continue

        condition = _require_dict(
            hour.get("condition"),
            "Weather provider returned an incomplete hourly forecast",
        )
        timestamp = hour.get("time")
        condition_text = condition.get("text")
        if not isinstance(timestamp, str) or not isinstance(condition_text, str):
            raise HTTPException(
                status_code=502,
                detail="Weather provider returned an incomplete hourly forecast",
            )
        hourly["time"].append(_clock_time(timestamp[-5:]))
        hourly["time_epoch"].append(epoch)
        hourly["temperature_2m"].append(
            _number(hour.get("temp_c"), "Weather provider returned an incomplete hourly forecast")
        )
        hourly["condition_text"].append(condition_text)
        hourly["precipitation_probability"].append(
            _number(
                hour.get("chance_of_rain"),
                "Weather provider returned an incomplete hourly forecast",
            )
        )

    return hourly, daily


def normalize_current_response(data: dict[str, Any]) -> dict[str, Any]:
    location = _place(_require_dict(data.get("location"), "Weather provider returned an invalid location"))
    current = _current(_require_dict(data.get("current"), "Weather provider returned incomplete conditions"))
    return {"place": location, "current": current}


def normalize_forecast_response(
    data: dict[str, Any],
    searched_location: dict[str, Any],
) -> dict[str, Any]:
    forecast_location = _require_dict(
        data.get("location"),
        "Weather provider returned an invalid location",
    )
    place = _place(
        {
            **forecast_location,
            **searched_location,
            "localtime": searched_location.get("localtime")
            or forecast_location.get("localtime"),
        }
    )
    current = _current(
        _require_dict(data.get("current"), "Weather provider returned incomplete conditions")
    )
    hourly, daily = _forecast_arrays(data)
    return {
        "place": place,
        "current": current,
        "hourly": hourly,
        "daily": daily,
    }


async def _fetch_featured_city(
    client: httpx.AsyncClient,
    api_key: str,
    city: str,
) -> dict[str, Any] | None:
    try:
        data = await provider_json(
            client,
            api_key,
            "current.json",
            {"q": city},
        )
        return normalize_current_response(_require_dict(data, "Weather provider returned an invalid response"))
    except HTTPException as error:
        logger.warning(
            "Featured weather refresh failed for %s with status %s",
            city,
            error.status_code,
        )
        return None


async def get_featured_weather(
    client: httpx.AsyncClient,
    api_key: str,
    offset: int = 0,
    limit: int = FEATURED_PAGE_SIZE,
) -> list[dict[str, Any]]:
    async with featured_refresh_lock:
        now = time.monotonic()
        cities = FEATURED_CITIES[offset : offset + limit]
        cities_to_refresh = [
            city
            for city in cities
            if (
                city not in featured_cache
                or now - featured_cache[city][0] >= FEATURED_CACHE_SECONDS
            )
        ]
        refreshed = await asyncio.gather(
            *(
                _fetch_featured_city(client, api_key, city)
                for city in cities_to_refresh
            )
        )

        for city, result in zip(cities_to_refresh, refreshed):
            if result is not None:
                featured_cache[city] = (time.monotonic(), result)

        now = time.monotonic()
        locations = []
        for city in cities:
            entry = featured_cache.get(city)
            if entry and now - entry[0] <= STALE_CACHE_SECONDS:
                locations.append(
                    {
                        **entry[1],
                        "stale": now - entry[0] >= FEATURED_CACHE_SECONDS,
                    }
                )
            else:
                locations.append(
                    {
                        "place": {
                            "name": city,
                            "admin1": None,
                            "country": None,
                            "lat": None,
                            "lon": None,
                            "timezone": None,
                            "localtime": None,
                        },
                        "current": None,
                        "stale": False,
                    }
                )
        return locations


@app.get("/health")
async def health():
    return {"status": "ok"}


@app.get("/featured")
async def featured(
    request: Request,
    offset: int = Query(default=0, ge=0),
    limit: int = Query(default=FEATURED_PAGE_SIZE, ge=1, le=FEATURED_PAGE_SIZE),
):
    locations = await get_featured_weather(
        request.app.state.http_client,
        request.app.state.weatherapi_key,
        offset,
        limit,
    )
    next_offset = offset + len(locations)
    has_more = next_offset < len(FEATURED_CITIES)
    return {
        "locations": locations,
        "has_more": has_more,
        "next_offset": next_offset if has_more else None,
    }


@app.get("/weather")
async def weather(
    request: Request,
    city: str = Query(min_length=2, max_length=80),
):
    api_key = request.app.state.weatherapi_key
    client = request.app.state.http_client

    # Fetch current weather first — gives us location + timezone
    data = await provider_json(
        client,
        api_key,
        "current.json",
        {"q": city},
    )
    location = _place(_require_dict(data.get("location"), "Weather provider returned an invalid location"))

    # Then fetch forecast using coordinates
    coordinates = f"{location['lat']},{location['lon']}"
    forecast = await provider_json(
        client,
        api_key,
        "forecast.json",
        {
            "q": coordinates,
            "days": "3",
            "aqi": "no",
            "alerts": "no",
        },
    )
    return normalize_forecast_response(
        _require_dict(forecast, "Weather provider returned an invalid forecast"),
        location,
    )