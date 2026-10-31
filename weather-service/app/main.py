from fastapi import FastAPI, HTTPException, Query
import httpx

app = FastAPI(title="Shaunek Weather Data Service", docs_url=None, redoc_url=None)
GEOCODE_URL = "https://geocoding-api.open-meteo.com/v1/search"
FORECAST_URL = "https://api.open-meteo.com/v1/forecast"

@app.get("/health")
async def health():
    return {"status": "ok"}

@app.get("/weather")
async def weather(city: str = Query(min_length=2, max_length=80)):
    timeout = httpx.Timeout(10.0, connect=4.0)
    async with httpx.AsyncClient(timeout=timeout) as client:
        try:
            geo = await client.get(GEOCODE_URL, params={"name": city, "count": 1, "language": "en", "format": "json"})
            geo.raise_for_status()
            results = geo.json().get("results") or []
            if not results:
                raise HTTPException(status_code=404, detail="City not found")
            place = results[0]
            forecast = await client.get(FORECAST_URL, params={
                "latitude": place["latitude"], "longitude": place["longitude"],
                "current": "temperature_2m,relative_humidity_2m,apparent_temperature,is_day,precipitation,weather_code,wind_speed_10m",
                "daily": "weather_code,temperature_2m_max,temperature_2m_min,sunrise,sunset,precipitation_probability_max",
                "timezone": "auto", "forecast_days": 7
            })
            forecast.raise_for_status()
            return {"place": {"name": place["name"], "country": place.get("country"), "admin1": place.get("admin1")},
                    "current": forecast.json().get("current"), "daily": forecast.json().get("daily")}
        except HTTPException:
            raise
        except (httpx.HTTPError, KeyError, ValueError):
            raise HTTPException(status_code=502, detail="Weather provider is temporarily unavailable")
